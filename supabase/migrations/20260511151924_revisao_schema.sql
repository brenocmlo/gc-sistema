-- ============================================================
-- 004_revisao_schema.sql — Sprint 3 (bloco 3.0)
-- ============================================================
-- Revisão geral das 13 tabelas + nova tabela `clientes`.
-- Decisões consolidadas em REVISAO-SCHEMA.md.
--
-- IMPORTANTE:
--   - Rodar em gc-dev primeiro, validar, depois em gc-prod (com backup).
--   - Operações DROP COLUMN bloqueiam leituras curtas — preferir
--     janela de manutenção em prod.
--   - Tudo dentro de uma única transação (atomic).
-- ============================================================

begin;

-- ============================================================
-- 0. DROP DE VIEWS QUE DEPENDEM DE COLUNAS ALTERADAS
-- ============================================================
-- Estas views usam SELECT *.* e bloqueiam o DROP/ALTER de colunas
-- abaixo. Serão recriadas no final da migration.
drop view if exists obras_com_valores;
drop view if exists contratos_financeiro;
drop view if exists propostas_financeiro;
drop view if exists itens_com_status;

-- ============================================================
-- 1. NOVA TABELA: clientes
-- ============================================================
-- Aceita PF e PJ via campo único `cnpj_cpf` (text, sem validação
-- de formato — pode conter caracteres alfanuméricos).

create table clientes (
  id uuid primary key default uuid_generate_v4(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nome text not null,
  cnpj_cpf text,
  contato text,
  telefone text,
  email text,
  endereco text,
  cidade text,
  cep text,
  observacao text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid references profiles(id),

  -- Pra FKs compostas multi-tenant em orcamentos/obras
  unique (id, empresa_id)
);

create unique index idx_clientes_cnpj_cpf_unique
  on clientes (empresa_id, cnpj_cpf)
  where cnpj_cpf is not null;

create index idx_clientes_empresa on clientes(empresa_id);
create index idx_clientes_nome on clientes(nome);

create trigger trg_clientes_updated before update on clientes
  for each row execute function update_updated_at();

-- ============================================================
-- 2. empresas: razao_social, logo_url, dados de contato e fiscais
-- ============================================================

alter table empresas
  add column razao_social text,
  add column logo_url text,
  add column email text,
  add column telefone text,
  add column endereco text,
  add column cidade text,
  add column cep text,
  add column inscricao_estadual text,
  add column inscricao_municipal text;

-- Backfill: razao_social = nome existente (pode ajustar depois pela UI)
update empresas set razao_social = nome where razao_social is null;

alter table empresas
  alter column razao_social set not null;

create unique index idx_empresas_cnpj_unique
  on empresas (cnpj)
  where cnpj is not null;

-- ============================================================
-- 3. profiles: telefone, UNIQUE email, CHECK formato email
-- ============================================================

alter table profiles
  add column telefone text;

create unique index idx_profiles_email_empresa_unique
  on profiles (empresa_id, email);

alter table profiles
  add constraint profiles_email_format
  check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- ============================================================
-- 4. orcamentos: cliente_id FK + drop cliente_* + drop doc_url
-- ============================================================
-- Estratégia: cria coluna nullable, popula via DISTINCT, depois NOT NULL.

alter table orcamentos
  add column cliente_id uuid;

-- Cria 1 cliente por (empresa_id, cliente_nome) único.
insert into clientes (empresa_id, nome, contato, telefone, email, cidade)
select distinct on (empresa_id, cliente_nome)
  empresa_id,
  cliente_nome,
  cliente_contato,
  cliente_telefone,
  cliente_email,
  cliente_cidade
from orcamentos
order by empresa_id, cliente_nome, created_at asc;

-- Vincula orçamentos aos clientes recém-criados
update orcamentos o
set cliente_id = c.id
from clientes c
where c.empresa_id = o.empresa_id
  and c.nome = o.cliente_nome;

alter table orcamentos
  alter column cliente_id set not null,
  add constraint orcamentos_cliente_fk
    foreign key (cliente_id, empresa_id) references clientes(id, empresa_id) on delete restrict,
  drop column cliente_nome,
  drop column cliente_contato,
  drop column cliente_telefone,
  drop column cliente_email,
  drop column cliente_cidade,
  drop column doc_url;

-- Constraint estrita: motivo_rejeicao só preenchido se status='rejeitado'
alter table orcamentos
  drop constraint orcamento_rejeitado_motivo,
  add constraint orcamento_rejeitado_motivo check (
    (status = 'rejeitado' and motivo_rejeicao is not null)
    or (status != 'rejeitado' and motivo_rejeicao is null)
  );

create index idx_orcamentos_cliente on orcamentos(cliente_id);

-- ============================================================
-- 5. obras: cliente_id FK + drop cliente_* + drop valores legacy
-- ============================================================

alter table obras
  add column cliente_id uuid;

-- Cria clientes a partir das obras que TINHAM cliente preenchido
insert into clientes (empresa_id, nome, contato, telefone, email, endereco, cidade, cep, cnpj_cpf)
select distinct on (empresa_id, cliente)
  empresa_id,
  cliente,
  contato,
  telefone,
  email,
  endereco,
  cidade,
  cep,
  cpf_cnpj
from obras
where cliente is not null
order by empresa_id, cliente, created_at asc
on conflict do nothing;

-- Vincula obras que tinham cliente preenchido
update obras o
set cliente_id = c.id
from clientes c
where o.cliente is not null
  and c.empresa_id = o.empresa_id
  and c.nome = o.cliente;

-- Cliente placeholder pra obras sem cliente (1 por empresa)
insert into clientes (empresa_id, nome)
select distinct empresa_id, '— Sem cliente informado —'
from obras
where cliente_id is null;

update obras o
set cliente_id = c.id
from clientes c
where o.cliente_id is null
  and c.empresa_id = o.empresa_id
  and c.nome = '— Sem cliente informado —';

alter table obras
  alter column cliente_id set not null,
  add constraint obras_cliente_fk
    foreign key (cliente_id, empresa_id) references clientes(id, empresa_id) on delete restrict;

-- Drop valor_final ANTES de valor_total/desconto (depende deles via GENERATED)
alter table obras
  drop column valor_final;

alter table obras
  drop column cliente,
  drop column contato,
  drop column cpf_cnpj,
  drop column telefone,
  drop column email,
  drop column valor_total,
  drop column desconto,
  drop column pct_sinal,
  drop column pct_fd,
  drop column pct_entrega_material,
  drop column pct_medicao_instalacao,
  drop column forma_pagamento,
  drop column doc_url;

alter table obras rename column observacoes to observacao;

drop index if exists idx_obras_cliente;
create index idx_obras_cliente_id on obras(cliente_id);

-- ============================================================
-- 6. propostas: drop doc_url, CHECK soma pct_, data_envio/decisao, motivo_rejeicao
-- ============================================================

alter table propostas
  drop column doc_url,
  add column data_envio date,
  add column data_decisao date,
  add column motivo_rejeicao text,
  add column detalhe_rejeicao text,
  add constraint propostas_pct_soma check (
    coalesce(pct_sinal, 0) + coalesce(pct_fd, 0)
    + coalesce(pct_entrega_material, 0) + coalesce(pct_medicao_instalacao, 0) <= 1.0
  ),
  add constraint propostas_motivo_rejeicao_check check (
    motivo_rejeicao is null or motivo_rejeicao in (
      'preco_alto', 'prazo_curto', 'perdeu_concorrente', 'cliente_desistiu',
      'sem_resposta', 'escopo_mudou', 'sem_capacidade', 'outro'
    )
  ),
  add constraint propostas_rejeitada_motivo check (
    (status = 'rejeitada' and motivo_rejeicao is not null)
    or (status != 'rejeitada' and motivo_rejeicao is null)
  );

-- ============================================================
-- 7. contratos: drop doc_url, CHECK soma pct_, motivo_rescisao
-- ============================================================

alter table contratos
  drop column doc_url,
  add column motivo_rescisao text,
  add column detalhe_rescisao text,
  add constraint contratos_pct_soma check (
    coalesce(pct_sinal, 0) + coalesce(pct_fd, 0)
    + coalesce(pct_entrega_material, 0) + coalesce(pct_medicao_instalacao, 0) <= 1.0
  ),
  add constraint contratos_motivo_rescisao_check check (
    motivo_rescisao is null or motivo_rescisao in (
      'inadimplencia', 'descumprimento_prazo', 'acordo_partes', 'forca_maior', 'outro'
    )
  ),
  add constraint contratos_rescindido_motivo check (
    (status = 'rescindido' and motivo_rescisao is not null)
    or (status != 'rescindido' and motivo_rescisao is null)
  );

-- ============================================================
-- 8. itens: unidade sem ML, valor_total e area_m2 GENERATED, observacao, uniques
-- ============================================================

-- Migra 'ML' existente pra 'QTD' (poderia perder informação; sem UI ainda não tem dados reais)
update itens set unidade = 'QTD' where unidade = 'ML';

alter table itens
  drop constraint itens_unidade_check;

alter table itens
  add constraint itens_unidade_check check (unidade in ('QTD', 'M2'));

-- valor_total: drop comum, recria como GENERATED
alter table itens drop column valor_total;
alter table itens
  add column valor_total numeric(14,2)
  generated always as (valor_unit * quantidade) stored;

-- area_m2: drop comum, recria como GENERATED (largura * altura * quantidade)
alter table itens drop column area_m2;
alter table itens
  add column area_m2 numeric(14,4)
  generated always as (largura * altura * quantidade) stored;

alter table itens
  add column observacao text;

create unique index idx_itens_numero_proposta
  on itens (proposta_id, numero)
  where proposta_id is not null;

create unique index idx_itens_numero_contrato
  on itens (contrato_id, numero)
  where contrato_id is not null;

-- ============================================================
-- 9. execucao: previsao_fim, localizacao, foto_url, múltiplas execuções,
--    valor_unit/valor_total, RLS de valor via trigger
-- ============================================================

-- Adicionar colunas novas
alter table execucao
  add column fab_previsao_fim date,
  add column ent_previsao_fim date,
  add column inst_previsao_fim date,
  add column med_previsao_fim date,
  add column localizacao text,
  add column foto_url text,
  add column valor_unit numeric(14,2) default 0 check (valor_unit >= 0);

-- valor_total GENERATED
alter table execucao
  add column valor_total numeric(14,2)
  generated always as (valor_unit * quantidade_total) stored;

-- Remove unicidade do item_id (permite múltiplas execuções por item)
-- A constraint auto-gerada se chama execucao_item_id_key
alter table execucao drop constraint execucao_item_id_key;

-- Sequencial: integer NOT NULL, default 1 pra registros existentes
alter table execucao
  add column sequencial integer not null default 1;

-- Backfill: registros existentes ficam todos com sequencial=1
-- (já é o default, mas explicito)
update execucao set sequencial = 1 where sequencial is null;

-- Remove default depois do backfill
alter table execucao
  alter column sequencial drop default;

create unique index idx_execucao_item_sequencial
  on execucao (item_id, sequencial);

-- Trigger: ao INSERT, puxa valor_unit do item se não informado
create or replace function execucao_pull_valor_from_item()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.valor_unit is null or new.valor_unit = 0 then
    select valor_unit into new.valor_unit from itens where id = new.item_id;
  end if;
  return new;
end;
$$;

create trigger trg_execucao_pull_valor
  before insert on execucao
  for each row execute function execucao_pull_valor_from_item();

-- Trigger: bloqueia UPDATE de valor_unit por perfis sem permissão
create or replace function execucao_check_valor_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.valor_unit is distinct from old.valor_unit then
    if not has_perfil(array['admin', 'financeiro']) then
      raise exception 'apenas admin ou financeiro pode alterar valor_unit em execucao';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_execucao_check_valor
  before update on execucao
  for each row execute function execucao_check_valor_update();

-- ============================================================
-- 10. notas_fiscais: chave_nfe, motivo_cancelamento, data_cancelamento,
--     status 'parcial' -> 'paga_parcialmente'
-- ============================================================

alter table notas_fiscais
  add column chave_nfe text,
  add column motivo_cancelamento text,
  add column data_cancelamento date;

create unique index idx_nfs_chave_nfe_unique
  on notas_fiscais (chave_nfe)
  where chave_nfe is not null;

-- Migra dados: 'parcial' -> 'paga_parcialmente'
-- Como existe CHECK constraint, precisa dropar, atualizar, recriar
alter table notas_fiscais drop constraint notas_fiscais_status_check;

update notas_fiscais set status = 'paga_parcialmente' where status = 'parcial';

alter table notas_fiscais
  add constraint notas_fiscais_status_check
  check (status in ('emitida', 'paga_parcialmente', 'paga', 'cancelada')),
  add constraint nf_cancelada_motivo check (
    (status = 'cancelada' and motivo_cancelamento is not null)
    or (status != 'cancelada' and motivo_cancelamento is null)
  );

-- ============================================================
-- 11. pagamentos: forma adiciona 'cartao', comprovante_url -> anexo
-- ============================================================

alter table pagamentos drop constraint pagamentos_forma_check;
alter table pagamentos
  add constraint pagamentos_forma_check
  check (forma in ('boleto', 'ted', 'pix', 'dinheiro', 'cheque', 'deposito', 'cartao', 'outro'));

alter table pagamentos rename column comprovante_url to anexo;

-- ============================================================
-- 12. acordo_parcelas: status rename 'parcial' -> 'paga_parcialmente',
--     remove 'atrasada' (vira runtime)
-- ============================================================

alter table acordo_parcelas drop constraint acordo_parcelas_status_check;

-- Migra dados: 'parcial' -> 'paga_parcialmente', 'atrasada' -> 'pendente'
update acordo_parcelas set status = 'paga_parcialmente' where status = 'parcial';
update acordo_parcelas set status = 'pendente' where status = 'atrasada';

alter table acordo_parcelas
  add constraint acordo_parcelas_status_check
  check (status in ('pendente', 'paga', 'paga_parcialmente', 'cancelada'));

-- ============================================================
-- 13. fd: unidade CHECK, CHECK valor_descontar <= valor
-- ============================================================

alter table fd
  add constraint fd_unidade_enum check (
    unidade is null or unidade in ('UN', 'KG', 'M', 'M2', 'PC', 'OUTRO')
  ),
  add constraint fd_valor_descontar_max check (valor_descontar <= valor);

-- ============================================================
-- 14. Atualiza funções/triggers que usavam 'parcial'/'atrasada'
-- ============================================================

create or replace function atualizar_status_parcela_by_id(p_parcela_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_valor_previsto numeric;
  v_total_pago numeric;
  v_status_atual text;
  v_novo_status text;
begin
  select valor_previsto, status
  into v_valor_previsto, v_status_atual
  from acordo_parcelas where id = p_parcela_id;

  if v_status_atual = 'cancelada' then
    return;
  end if;

  select coalesce(sum(valor), 0) into v_total_pago
  from pagamentos where parcela_acordo_id = p_parcela_id;

  if v_total_pago >= v_valor_previsto and v_valor_previsto > 0 then
    v_novo_status := 'paga';
  elsif v_total_pago > 0 then
    v_novo_status := 'paga_parcialmente';
  else
    v_novo_status := 'pendente';
  end if;

  update acordo_parcelas
  set status = v_novo_status
  where id = p_parcela_id
    and status != v_novo_status;
end;
$$;

create or replace function atualizar_status_nf_by_id(p_nota_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_valor_total numeric;
  v_total_pago numeric;
  v_status_atual text;
  v_novo_status text;
begin
  select valor_total, status
  into v_valor_total, v_status_atual
  from notas_fiscais where id = p_nota_id;

  if v_status_atual = 'cancelada' then
    return;
  end if;

  select coalesce(sum(valor), 0) into v_total_pago
  from pagamentos where nota_id = p_nota_id;

  if v_total_pago >= v_valor_total and v_valor_total > 0 then
    v_novo_status := 'paga';
  elsif v_total_pago > 0 then
    v_novo_status := 'paga_parcialmente';
  else
    v_novo_status := 'emitida';
  end if;

  update notas_fiscais
  set status = v_novo_status
  where id = p_nota_id
    and status != v_novo_status;
end;
$$;

-- ============================================================
-- 15. RECRIA AS VIEWS DROPADAS NO INÍCIO
-- ============================================================
-- Definições idênticas às originais de 001_initial.sql. Como as colunas
-- legacy de obras/contratos/propostas/itens foram removidas, as queries
-- com SELECT * naturalmente passam a refletir o novo schema.

create or replace view obras_com_valores with (security_invoker = true) as
select
  o.*,
  calc.valor_total as valor_total_calculado,
  calc.desconto as desconto_calculado,
  calc.valor_final as valor_final_calculado,
  calc.pct_sinal as pct_sinal_calculado,
  calc.pct_fd as pct_fd_calculado,
  calc.pct_entrega_material as pct_entrega_material_calculado,
  calc.pct_medicao_instalacao as pct_medicao_instalacao_calculado,
  calc.condicoes_pagamento as condicoes_pagamento_calculado,
  calc.fonte as fonte_valores
from obras o,
  lateral calcular_valores_obra(o.id) calc;

grant select on obras_com_valores to authenticated;

create or replace view contratos_financeiro with (security_invoker = true) as
select
  c.*,
  coalesce((
    select sum(valor_total) from notas_fiscais nf
    where nf.contrato_id = c.id and nf.status != 'cancelada'
  ), 0) as total_nfs,
  coalesce((
    select sum(ap.valor_previsto)
    from acordo_parcelas ap
    join acordos_pagamento a on a.id = ap.acordo_id
    where a.contrato_id = c.id
      and a.status not in ('cancelado', 'convertido_nf')
      and ap.status != 'cancelada'
  ), 0) as total_acordos,
  coalesce((
    select sum(p.valor)
    from pagamentos p
    join notas_fiscais nf on nf.id = p.nota_id
    where nf.contrato_id = c.id and nf.status != 'cancelada'
  ), 0) as recebido_nfs,
  coalesce((
    select sum(p.valor)
    from pagamentos p
    join acordo_parcelas ap on ap.id = p.parcela_acordo_id
    join acordos_pagamento a on a.id = ap.acordo_id
    where a.contrato_id = c.id
      and p.origem = 'acordo'
      and a.status not in ('cancelado', 'convertido_nf')
  ), 0) as recebido_acordos,
  c.valor_total - (
    coalesce((
      select sum(valor_total) from notas_fiscais nf
      where nf.contrato_id = c.id and nf.status != 'cancelada'
    ), 0) +
    coalesce((
      select sum(ap.valor_previsto)
      from acordo_parcelas ap
      join acordos_pagamento a on a.id = ap.acordo_id
      where a.contrato_id = c.id
        and a.status not in ('cancelado', 'convertido_nf')
        and ap.status != 'cancelada'
    ), 0)
  ) as saldo_a_faturar
from contratos c;

grant select on contratos_financeiro to authenticated;

create or replace view propostas_financeiro with (security_invoker = true) as
select
  p.*,
  coalesce((
    select sum(valor_total) from notas_fiscais nf
    where nf.proposta_id = p.id and nf.status != 'cancelada'
  ), 0) as total_nfs,
  coalesce((
    select sum(ap.valor_previsto)
    from acordo_parcelas ap
    join acordos_pagamento a on a.id = ap.acordo_id
    where a.proposta_id = p.id
      and a.status not in ('cancelado', 'convertido_nf')
      and ap.status != 'cancelada'
  ), 0) as total_acordos,
  coalesce((
    select sum(pg.valor)
    from pagamentos pg
    join notas_fiscais nf on nf.id = pg.nota_id
    where nf.proposta_id = p.id and nf.status != 'cancelada'
  ), 0) as recebido_nfs,
  coalesce((
    select sum(pg.valor)
    from pagamentos pg
    join acordo_parcelas ap on ap.id = pg.parcela_acordo_id
    join acordos_pagamento a on a.id = ap.acordo_id
    where a.proposta_id = p.id
      and pg.origem = 'acordo'
      and a.status not in ('cancelado', 'convertido_nf')
  ), 0) as recebido_acordos
from propostas p;

grant select on propostas_financeiro to authenticated;

create or replace view itens_com_status with (security_invoker = true) as
select
  i.*,
  coalesce(e.fab_status, 'pendente') as status_fabricacao,
  coalesce(e.ent_status, 'pendente') as status_entrega,
  coalesce(e.inst_status, 'pendente') as status_instalacao,
  coalesce(e.med_status, 'pendente') as status_medicao,
  coalesce(e.fab_qtd, 0) as qtd_fabricada,
  coalesce(e.ent_qtd, 0) as qtd_entregue,
  coalesce(e.inst_qtd, 0) as qtd_instalada,
  coalesce(e.med_qtd, 0) as qtd_medida,
  e.fab_data_atualizacao as data_ultima_fabricacao,
  e.fab_data_fim as data_fabricacao_concluida,
  e.ent_data_atualizacao as data_ultima_entrega,
  e.ent_data_fim as data_entrega_concluida,
  e.inst_data_atualizacao as data_ultima_instalacao,
  e.inst_data_fim as data_instalacao_concluida,
  e.med_data_atualizacao as data_ultima_medicao,
  e.med_data_fim as data_medicao_concluida,
  e.fab_responsavel as responsavel_fabricacao,
  e.ent_responsavel as responsavel_entrega,
  e.inst_responsavel as responsavel_instalacao,
  e.med_responsavel as responsavel_medicao,
  case
    when e.med_status = 'concluido' then 'medido'
    when e.med_status = 'andamento' then 'medindo'
    when e.inst_status = 'concluido' then 'aguardando_medicao'
    when e.inst_status = 'andamento' then 'instalando'
    when e.ent_status = 'concluido' then 'aguardando_instalacao'
    when e.ent_status = 'andamento' then 'entregando'
    when e.fab_status = 'concluido' then 'aguardando_entrega'
    when e.fab_status = 'andamento' then 'fabricando'
    else 'aguardando_fabricacao'
  end as status_atual,
  case
    when e.med_status = 'concluido' then 'finalizado'
    when e.inst_status = 'concluido' or e.med_status in ('andamento') then 'medicao'
    when e.ent_status = 'concluido' or e.inst_status in ('andamento') then 'instalacao'
    when e.fab_status = 'concluido' or e.ent_status in ('andamento') then 'entrega'
    else 'fabricacao'
  end as etapa_atual,
  case
    when coalesce(e.quantidade_total, 0) = 0 then 0
    else round((
      coalesce(e.fab_qtd, 0) / e.quantidade_total * 25 +
      coalesce(e.ent_qtd, 0) / e.quantidade_total * 25 +
      coalesce(e.inst_qtd, 0) / e.quantidade_total * 25 +
      coalesce(e.med_qtd, 0) / e.quantidade_total * 25
    )::numeric, 2)
  end as progresso_pct,
  (
    case when e.fab_status = 'concluido' then 25 else 0 end +
    case when e.ent_status = 'concluido' then 25 else 0 end +
    case when e.inst_status = 'concluido' then 25 else 0 end +
    case when e.med_status = 'concluido' then 25 else 0 end
  ) as progresso_etapas_pct,
  jsonb_array_length(coalesce(e.evidencias, '[]'::jsonb)) as evidencias_count
from itens i
left join execucao e on e.item_id = i.id;

grant select on itens_com_status to authenticated;

commit;
