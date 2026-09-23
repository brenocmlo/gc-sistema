-- ============================================================
-- 019_auditoria_eventos.sql
-- ============================================================
-- Bloco 13.2 — "histórico e auditoria de mudanças", adiantado em 2026-09-23
-- junto com a tela /logs. Decisão do checklist do bloco ("campo jsonb por
-- entidade ou tabela central"): TABELA CENTRAL. O `historico` jsonb de
-- propostas e orçamentos continua como está — ele alimenta a aba Histórico da
-- tela de detalhe e guarda o motivo de rejeição; esta tabela é a trilha da
-- empresa inteira, de todas as entidades, com o diff campo a campo.
--
-- Três jeitos de um evento entrar aqui:
--
-- 1. TRIGGER `auditar_mudanca` nas tabelas de negócio. Pega todo insert,
--    update e delete que CHEGOU A GRAVAR, venha da tela, do n8n ou de SQL
--    direto. Registra quem, quando, o que, e no update só os campos que
--    mudaram (de → para). Update que só mexe em `updated_at` não gera evento.
--
-- 2. RPC `registrar_evento`, para o que o trigger não vê: o ERRO. Uma escrita
--    recusada (CHECK, RLS, regra da Server Action) sofre rollback e leva o
--    trigger junto, então a falha só fica registrada se alguém gravar por
--    fora. É o que as Server Actions (etapa B) e o n8n (etapa C) chamam.
--
-- 3. Nada mais: sem policy de insert, ninguém com sessão escreve direto.
--
-- `origem` sai de quem está conectado, não de um parâmetro:
--   sistema   → há `auth.uid()`: uma pessoa, pela tela
--   automacao → chave de serviço (n8n, rota de ingestão, scripts com service role)
--   banco     → SQL direto como postgres (migration, seed, SQL editor)
--
-- A REGRA QUE NÃO PODE QUEBRAR: auditoria nunca derruba a gravação de negócio.
-- O corpo do trigger está num bloco com `exception when others` que vira
-- WARNING. Perder um evento é ruim; perder a proposta que a ingestão estava
-- gravando porque a auditoria falhou é pior.
--
-- Imutável: update é recusado por trigger, para qualquer papel. Delete não tem
-- policy, então só a chave de serviço apaga — é o que a limpeza da camada de
-- escrita do plano de validação usa, e o que uma rotina de retenção usaria.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Tabela
-- ------------------------------------------------------------
create table auditoria_eventos (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas(id) on delete cascade,
  em timestamptz not null default now(),
  origem text not null check (origem in ('sistema', 'automacao', 'banco')),
  -- Nome da tabela para eventos de trigger ('propostas', 'itens', ...); livre
  -- para eventos da RPC ('documentos_processamento', 'ingestao', ...).
  entidade text not null check (char_length(entidade) between 1 and 64),
  registro_id uuid,
  -- Trigger: 'criar' | 'editar' | 'status' | 'excluir'. RPC: livre, curto.
  acao text not null check (char_length(acao) between 1 and 64),
  resultado text not null default 'sucesso' check (resultado in ('sucesso', 'erro')),
  mensagem text check (mensagem is null or char_length(mensagem) <= 4000),
  autor_id uuid references profiles(id) on delete set null,
  -- Quem é o autor quando não é um profile: 'service_role', 'postgres', ou o
  -- que a automação disser (ex.: 'telegram:-100123').
  autor_descricao text check (autor_descricao is null or char_length(autor_descricao) <= 200),
  -- Update: { "campos": { "<coluna>": { "de": ..., "para": ... } } }
  -- Criar/excluir: { "linha": { ...a linha inteira... } }
  -- RPC: o que quem chamou mandar.
  detalhe jsonb
);

create index idx_auditoria_eventos_empresa_em on auditoria_eventos(empresa_id, em desc);
create index idx_auditoria_eventos_registro on auditoria_eventos(entidade, registro_id);

-- ------------------------------------------------------------
-- Imutabilidade
-- ------------------------------------------------------------
create or replace function auditoria_recusar_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception using message = 'auditoria_imutavel';
end;
$$;

create trigger trg_auditoria_eventos_imutavel
  before update on auditoria_eventos
  for each row execute function auditoria_recusar_update();

-- ------------------------------------------------------------
-- RLS: só admin lê, da própria empresa. Nenhuma policy de escrita.
-- ------------------------------------------------------------
alter table auditoria_eventos enable row level security;

drop policy if exists "Auditoria: ver da empresa (admin)" on auditoria_eventos;

create policy "Auditoria: ver da empresa (admin)" on auditoria_eventos
  for select using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin'])
  );

-- ------------------------------------------------------------
-- Quem está conectado → (origem, autor_descricao)
-- ------------------------------------------------------------
-- `auth.jwt()` devolve null fora de uma requisição do PostgREST (SQL direto);
-- aí o papel é o `current_user`.
create or replace function auditoria_origem()
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when auth.uid() is not null then 'sistema'
    when coalesce(auth.jwt() ->> 'role', '') = 'service_role' then 'automacao'
    else 'banco'
  end;
$$;

-- ------------------------------------------------------------
-- Trigger genérico
-- ------------------------------------------------------------
create or replace function auditar_mudanca()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_linha jsonb;
  v_campos jsonb := '{}'::jsonb;
  v_chave text;
  v_acao text;
  v_uid uuid := auth.uid();
  v_origem text;
  v_empresa uuid;
begin
  begin
    if tg_op = 'INSERT' then
      v_new := to_jsonb(new);
      v_linha := v_new;
    elsif tg_op = 'DELETE' then
      v_old := to_jsonb(old);
      v_linha := v_old;
    else
      v_old := to_jsonb(old);
      v_new := to_jsonb(new);
      v_linha := v_new;
    end if;

    v_empresa := nullif(v_linha ->> 'empresa_id', '')::uuid;
    if v_empresa is null then
      return null;
    end if;

    if tg_op = 'UPDATE' then
      for v_chave in select jsonb_object_keys(v_new) loop
        -- updated_at muda em todo update; historico é o espelho do status, que
        -- já entra no diff pela própria coluna.
        continue when v_chave in ('updated_at', 'historico');
        if (v_old -> v_chave) is distinct from (v_new -> v_chave) then
          v_campos := v_campos || jsonb_build_object(
            v_chave,
            case
              -- O JSON da IA é grande e não se lê num diff: só diz que mudou.
              when v_chave = 'dados_extraidos' then
                jsonb_build_object('de', '[omitido]', 'para', '[omitido]')
              else
                jsonb_build_object('de', v_old -> v_chave, 'para', v_new -> v_chave)
            end
          );
        end if;
      end loop;

      if v_campos = '{}'::jsonb then
        return null;
      end if;
      v_acao := case when v_campos ? 'status' then 'status' else 'editar' end;
    else
      v_acao := case tg_op when 'INSERT' then 'criar' else 'excluir' end;
    end if;

    v_origem := auditoria_origem();

    insert into auditoria_eventos (
      empresa_id, origem, entidade, registro_id, acao, resultado,
      autor_id, autor_descricao, detalhe
    ) values (
      v_empresa,
      v_origem,
      tg_table_name,
      nullif(v_linha ->> 'id', '')::uuid,
      v_acao,
      'sucesso',
      -- Sem sessão, o autor de uma criação é quem a linha diz que criou (a
      -- ingestão grava o profile de serviço em created_by). Num update ou
      -- delete sem sessão, created_by é o autor ORIGINAL, não quem mexeu agora
      -- — por isso não vale ali.
      coalesce(
        v_uid,
        case when tg_op = 'INSERT' then nullif(v_linha ->> 'created_by', '')::uuid end
      ),
      case when v_uid is null then coalesce(auth.jwt() ->> 'role', current_user) end,
      case
        when tg_op = 'UPDATE' then jsonb_build_object('campos', v_campos)
        else jsonb_build_object('linha', v_linha - 'dados_extraidos')
      end
    );
  exception when others then
    raise warning 'auditoria: não registrou % em %: %', tg_op, tg_table_name, sqlerrm;
  end;
  return null;
end;
$$;

-- As tabelas de negócio: todas as que têm empresa_id. `empresas` fica de fora
-- (não tem empresa_id, e só muda por migration).
do $$
declare
  t text;
begin
  foreach t in array array[
    'clientes', 'orcamentos', 'obras', 'propostas', 'contratos', 'itens',
    'execucao', 'notas_fiscais', 'pagamentos', 'acordos_pagamento',
    'acordo_parcelas', 'fd', 'documentos_processamento', 'contatos_whatsapp',
    'profiles'
  ] loop
    execute format('drop trigger if exists trg_%1$s_auditoria on %1$I', t);
    execute format(
      'create trigger trg_%1$s_auditoria after insert or update or delete on %1$I '
      'for each row execute function auditar_mudanca()',
      t
    );
  end loop;
end;
$$;

-- ------------------------------------------------------------
-- registrar_evento: o que o trigger não vê (erros, eventos da automação)
-- ------------------------------------------------------------
-- Com sessão: empresa e autor saem da sessão, e `p_empresa_id` é ignorado —
-- ninguém registra evento em nome de outra empresa nem de outra pessoa.
-- Sem sessão: só a chave de serviço (o n8n), que precisa dizer a empresa.
create or replace function registrar_evento(
  p_entidade text,
  p_acao text,
  p_resultado text,
  p_mensagem text default null,
  p_registro_id uuid default null,
  p_detalhe jsonb default null,
  p_empresa_id uuid default null,
  p_autor_descricao text default null
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_empresa uuid;
  v_origem text := auditoria_origem();
  v_id bigint;
begin
  if v_uid is not null then
    v_empresa := current_empresa_id();
  elsif v_origem in ('automacao', 'banco') then
    v_empresa := p_empresa_id;
  end if;

  if v_empresa is null then
    raise exception using message = 'auditoria_sem_empresa';
  end if;

  insert into auditoria_eventos (
    empresa_id, origem, entidade, registro_id, acao, resultado, mensagem,
    autor_id, autor_descricao, detalhe
  ) values (
    v_empresa, v_origem, p_entidade, p_registro_id, p_acao, p_resultado,
    left(p_mensagem, 4000),
    v_uid,
    case when v_uid is null then coalesce(p_autor_descricao, auth.jwt() ->> 'role', current_user) end,
    p_detalhe
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- anon não chama: sem sessão, sem chave de serviço, não há como saber quem é.
revoke all on function registrar_evento(text, text, text, text, uuid, jsonb, uuid, text) from public, anon;
grant execute on function registrar_evento(text, text, text, text, uuid, jsonb, uuid, text) to authenticated, service_role;

-- As funções internas não são API.
revoke all on function auditar_mudanca() from public, anon, authenticated;
revoke all on function auditoria_recusar_update() from public, anon, authenticated;

commit;
