-- Log da automação (Breno, 28/09): "o log de erros da automação precisa ser
-- descritivo e mostrado no sistema, e preciso saber em que etapa estamos".
--
-- 1. documentos_processamento ganha a ETAPA atual (na fila, lendo, reserva,
--    gravando, concluído, revisão, erro) e o detalhe cru do último erro. Quem
--    grava: o n8n (a cada passo) e o sistema (envio pela tela, reprocesso).
-- 2. automacao_eventos guarda o histórico. Um trigger registra sozinho cada
--    mudança de etapa, status ou conferência do documento — ninguém precisa
--    lembrar de logar. O n8n grava direto só o que não tem documento: erro de
--    sistema (ex.: limite de execuções do plano), que chega pelo Error Trigger.
-- 3. A tradução do erro cru para frase de gente fica no código
--    (src/lib/automacao.ts), com teste; aqui só se guarda o cru.

begin;

alter table documentos_processamento
  add column if not exists etapa text,
  add column if not exists etapa_detalhe text,
  add column if not exists etapa_em timestamptz;

comment on column documentos_processamento.etapa is
  'Etapa atual da automação: NA_FILA, LEITURA, LEITURA_RESERVA, GRAVANDO, CONCLUIDO, REVISAO, ERRO.';
comment on column documentos_processamento.etapa_detalhe is
  'Detalhe cru da etapa (erro do n8n, da IA ou da rota). Traduzido na tela por descreverErro.';

create table if not exists automacao_eventos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas(id) on delete cascade,
  documento_id uuid references documentos_processamento(id) on delete cascade,
  origem text not null default 'documento' check (origem in ('documento', 'n8n', 'sistema')),
  etapa text not null,
  nivel text not null check (nivel in ('info', 'aviso', 'erro')),
  mensagem text not null,
  detalhe text,
  execucao_id text,
  criado_por uuid,
  criado_em timestamptz not null default now()
);

create index if not exists idx_automacao_eventos_empresa on automacao_eventos (empresa_id, criado_em desc);
create index if not exists idx_automacao_eventos_documento on automacao_eventos (documento_id, criado_em);

alter table automacao_eventos enable row level security;

-- Leitura: a empresa vê os seus; o que não tem empresa (erro de sistema do
-- n8n, que chega sem saber de quem é) só admin e comercial veem. Escrita: só
-- service role (n8n) e o trigger abaixo — nenhuma policy de insert.
drop policy if exists "Automação eventos: ver" on automacao_eventos;
create policy "Automação eventos: ver" on automacao_eventos
  for select using (
    empresa_id = current_empresa_id()
    or (empresa_id is null and has_perfil(array['admin', 'comercial']))
  );

create or replace function registrar_evento_documento()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nivel text;
  v_msg text;
  v_etapa text;
begin
  if tg_op = 'UPDATE'
     and new.etapa is not distinct from old.etapa
     and new.etapa_detalhe is not distinct from old.etapa_detalhe
     and new.status is not distinct from old.status
     and new.conferencia is not distinct from old.conferencia then
    return new;
  end if;

  v_etapa := coalesce(new.etapa, case new.status when 'PENDENTE' then 'NA_FILA' when 'APROVADO' then 'CONCLUIDO' else 'REVISAO' end);

  v_nivel := case
    when new.etapa = 'ERRO' then 'erro'
    when new.etapa = 'LEITURA_RESERVA' then 'aviso'
    when new.status in ('REVISAO_HUMANA', 'ERRO_VALIDACAO') then 'aviso'
    when new.etapa = 'CONCLUIDO' and new.etapa_detalhe is not null then 'aviso'
    else 'info'
  end;

  v_msg := case
    when tg_op = 'INSERT' then 'documento recebido'
    when new.conferencia is distinct from old.conferencia then 'conferência: ' || coalesce(new.conferencia, '—')
    when new.status is distinct from old.status and new.etapa is not distinct from old.etapa then 'status: ' || new.status
    else 'etapa: ' || v_etapa
  end;

  insert into automacao_eventos (empresa_id, documento_id, origem, etapa, nivel, mensagem, detalhe, criado_por)
  values (new.empresa_id, new.id, 'documento', v_etapa, v_nivel, v_msg, new.etapa_detalhe, auth.uid());

  return new;
end $$;

-- A etapa_em é carimbada no BEFORE; o evento, no AFTER (precisa do id).
create or replace function carimbar_etapa_documento()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' or new.etapa is distinct from old.etapa then
    new.etapa_em := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_documentos_etapa_em on documentos_processamento;
create trigger trg_documentos_etapa_em
  before insert or update on documentos_processamento
  for each row execute function carimbar_etapa_documento();

drop trigger if exists trg_documentos_evento on documentos_processamento;
create trigger trg_documentos_evento
  after insert or update on documentos_processamento
  for each row execute function registrar_evento_documento();

commit;
