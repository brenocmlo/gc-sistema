-- ============================================================
-- 021_contratos_desconto_historico.sql
-- ============================================================
-- Base da sprint 6 (Contratos). Três lacunas de `contratos` que os blocos
-- 6.1 a 6.5 esbarram, e que por isso entram antes de qualquer tela:
--
-- 1. DESCONTO E VALOR FINAL.
--    `propostas` tem `desconto` e `valor_final` (GENERATED); `contratos` só tem
--    `valor_total`. Conferido em gc-dev em 2026-09-23: as três propostas
--    aprovadas têm desconto (R$ 8 mil, R$ 30 mil e R$ 38 mil). Gerar contrato
--    delas (bloco 6.2) sem ter onde pôr o desconto obrigaria a escolher entre
--    perder o desconto ou gravar como "valor total" um número que não é a soma
--    dos itens — e o trigger do 5.6 sobrescreveria esse número no primeiro item.
--    Mesmo desenho de `propostas`: `desconto >= 0`, `desconto <= valor_total`,
--    `valor_final` GENERATED.
--
-- 2. HISTÓRICO DE STATUS (bloco 6.5).
--    Mesmo formato de `propostas.historico` (20260905180000): lista jsonb
--    append-only, uma entrada por transição. O trigger de auditoria do 13.2 já
--    deixa `historico` fora do diff, então a coluna nova entra sem mudança lá.
--
-- 3. QUEM LÊ `contratos.valor_total` COMO SE FOSSE O VALOR DEVIDO.
--    a) `calcular_valores_obra` já tinha o lugar do desconto do contrato,
--       fixado em `0::numeric` porque a coluna não existia. Passa a ler
--       `c.desconto`.
--    b) `contratos_financeiro.saldo_a_faturar` = valor_total − faturado. Com
--       desconto, o que se fatura é o valor final. A view é recriada (drop +
--       create): ela usa `c.*`, que foi expandido na criação, e as colunas
--       novas no meio da lista impedem `create or replace`. Nenhuma view
--       depende dela (conferido em pg_depend).
--    c) O ramo de contratos do trigger `recalcular_valor_do_pai_do_item` não
--       conferia desconto ("Contrato não tem desconto"). Passa a ter a mesma
--       escolha 3 das propostas: soma abaixo do desconto não sincroniza.
--
-- Os três contratos que existem hoje em gc-dev (automação, TESTE-FASE2-*)
-- ficam com desconto 0: valor_final = valor_total, nada muda para eles.
-- Aditiva. Rollback no fim.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. desconto, valor_final, historico
-- ------------------------------------------------------------
alter table contratos
  add column if not exists desconto numeric(14,2) not null default 0
    check (desconto >= 0),
  add column if not exists historico jsonb not null default '[]'::jsonb;

alter table contratos
  drop constraint if exists contratos_desconto_valido,
  add constraint contratos_desconto_valido check (desconto <= valor_total),
  drop constraint if exists contratos_historico_lista,
  add constraint contratos_historico_lista check (jsonb_typeof(historico) = 'array');

alter table contratos
  add column if not exists valor_final numeric(14,2)
    generated always as (valor_total - desconto) stored;

comment on column contratos.desconto is
  'Sprint 6: desconto herdado da proposta de origem ou digitado. valor_final = valor_total - desconto.';
comment on column contratos.historico is
  'Append-only: uma entrada por transição de status (bloco 6.5). Mesmo formato de propostas.historico.';

-- ------------------------------------------------------------
-- 2. contratos_financeiro — saldo sobre o valor final
-- ------------------------------------------------------------
drop view if exists contratos_financeiro;

create view contratos_financeiro with (security_invoker = true) as
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
  -- Era `c.valor_total - (...)`. Com desconto, o devido é o valor final.
  c.valor_final - (
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

-- ------------------------------------------------------------
-- 3. calcular_valores_obra — o desconto do contrato deixa de ser 0
-- ------------------------------------------------------------
-- Idêntica à de 20260905190000, exceto `c_vigentes` (lê c.desconto) e
-- `todos` (usa cv.desconto no lugar de 0::numeric).
create or replace function calcular_valores_obra(p_obra_id uuid)
returns table (
  valor_total numeric,
  desconto numeric,
  valor_final numeric,
  pct_sinal numeric,
  pct_fd numeric,
  pct_entrega_material numeric,
  pct_medicao_instalacao numeric,
  condicoes_pagamento text,
  fonte text
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tem_contrato boolean;
  v_tem_proposta_aprovada boolean;
begin
  select exists(
    select 1 from contratos c
    where c.obra_id = p_obra_id and c.status != 'rescindido'
  ) into v_tem_contrato;

  select exists(
    select 1 from propostas p
    where p.obra_id = p_obra_id
      and p.status = 'aprovada'
      and not exists (
        select 1 from contratos c
        where c.proposta_origem_id = p.id and c.status != 'rescindido'
      )
  ) into v_tem_proposta_aprovada;

  if v_tem_contrato or v_tem_proposta_aprovada then
    return query
    with
    c_vigentes as (
      -- Alias obrigatório: sem o `c.`, valor_total colide com o OUT param.
      select c.valor_total, c.desconto, c.pct_sinal, c.pct_fd, c.pct_entrega_material,
             c.pct_medicao_instalacao, c.condicoes_pagamento
      from contratos c
      where c.obra_id = p_obra_id and c.status != 'rescindido'
    ),
    p_aprovadas_sem_contrato as (
      select p.valor_total, p.desconto, p.pct_sinal, p.pct_fd,
             p.pct_entrega_material, p.pct_medicao_instalacao, p.condicoes_pagamento
      from propostas p
      where p.obra_id = p_obra_id
        and p.status = 'aprovada'
        and not exists (
          select 1 from contratos c
          where c.proposta_origem_id = p.id and c.status != 'rescindido'
        )
    ),
    todos as (
      select cv.valor_total, cv.desconto, cv.pct_sinal, cv.pct_fd,
             cv.pct_entrega_material, cv.pct_medicao_instalacao,
             cv.condicoes_pagamento
      from c_vigentes cv
      union all
      select pa.valor_total, pa.desconto, pa.pct_sinal, pa.pct_fd,
             pa.pct_entrega_material, pa.pct_medicao_instalacao,
             pa.condicoes_pagamento
      from p_aprovadas_sem_contrato pa
    )
    select
      coalesce(sum(t.valor_total), 0)::numeric,
      coalesce(sum(t.desconto), 0)::numeric,
      coalesce(sum(t.valor_total) - sum(t.desconto), 0)::numeric,
      case when sum(t.valor_total - t.desconto) > 0
        then sum(t.pct_sinal * (t.valor_total - t.desconto)) / sum(t.valor_total - t.desconto)
        else 0 end::numeric,
      case when sum(t.valor_total - t.desconto) > 0
        then sum(t.pct_fd * (t.valor_total - t.desconto)) / sum(t.valor_total - t.desconto)
        else 0 end::numeric,
      case when sum(t.valor_total - t.desconto) > 0
        then sum(t.pct_entrega_material * (t.valor_total - t.desconto)) / sum(t.valor_total - t.desconto)
        else 0 end::numeric,
      case when sum(t.valor_total - t.desconto) > 0
        then sum(t.pct_medicao_instalacao * (t.valor_total - t.desconto)) / sum(t.valor_total - t.desconto)
        else 0 end::numeric,
      string_agg(nullif(t.condicoes_pagamento, ''), E'\n---\n'),
      case
        when v_tem_contrato and v_tem_proposta_aprovada then 'contratos+propostas'
        when v_tem_contrato then 'contratos'
        else 'propostas'
      end::text
    from todos t;
  else
    return query
    select
      0::numeric, 0::numeric, 0::numeric,
      0::numeric, 0::numeric, 0::numeric, 0::numeric,
      null::text,
      'sem_proposta'::text
    from obras o
    where o.id = p_obra_id;
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 4. Trigger do 5.6 — ramo de contratos respeita o desconto
-- ------------------------------------------------------------
-- Idêntico ao de 20260922130000 no ramo de propostas. `create or replace`
-- redefine a função inteira, inclusive o privilégio: o `security definer` de
-- 20260922140000 vai declarado aqui de novo, senão voltaria a invoker.
create or replace function recalcular_valor_do_pai_do_item()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_propostas uuid[] := '{}';
  v_contratos uuid[] := '{}';
  v_id uuid;
  v_qtd bigint;
  v_soma numeric;
  v_desconto numeric;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if old.proposta_id is not null then v_propostas := v_propostas || old.proposta_id; end if;
    if old.contrato_id is not null then v_contratos := v_contratos || old.contrato_id; end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if new.proposta_id is not null then v_propostas := v_propostas || new.proposta_id; end if;
    if new.contrato_id is not null then v_contratos := v_contratos || new.contrato_id; end if;
  end if;

  foreach v_id in array coalesce(
    (select array_agg(distinct x order by x) from unnest(v_propostas) x), '{}'::uuid[]
  ) loop
    select p.desconto into v_desconto from propostas p where p.id = v_id for update;
    continue when not found;

    select count(*), coalesce(sum(i.valor_total), 0)
      into v_qtd, v_soma
      from itens i where i.proposta_id = v_id;

    continue when v_qtd = 0;
    continue when v_soma < coalesce(v_desconto, 0);

    update propostas p
       set valor_total = v_soma
     where p.id = v_id
       and p.valor_total is distinct from v_soma;
  end loop;

  foreach v_id in array coalesce(
    (select array_agg(distinct x order by x) from unnest(v_contratos) x), '{}'::uuid[]
  ) loop
    -- Mesma trava e mesma leitura de desconto das propostas.
    select c.desconto into v_desconto from contratos c where c.id = v_id for update;
    continue when not found;

    select count(*), coalesce(sum(i.valor_total), 0)
      into v_qtd, v_soma
      from itens i where i.contrato_id = v_id;
    continue when v_qtd = 0;

    -- Escolha 3, agora também em contratos: soma abaixo do desconto não cabe
    -- no CHECK `contratos_desconto_valido`; fica o valor digitado.
    continue when v_soma < coalesce(v_desconto, 0);

    update contratos c
       set valor_total = v_soma
     where c.id = v_id
       and c.valor_total is distinct from v_soma;
  end loop;

  return null;
end $$;

revoke execute on function recalcular_valor_do_pai_do_item() from public, anon, authenticated;

comment on function recalcular_valor_do_pai_do_item() is
  'Bloco 5.6: mantém propostas.valor_total e contratos.valor_total iguais à soma '
  'dos itens quando há itens. Sem itens, o valor é digitado e não é tocado. '
  'Trava o pai antes de somar. Soma abaixo do desconto não sincroniza '
  '(contratos desde 20260923160000).';

do $$
begin
  if not (select prosecdef from pg_proc where proname = 'recalcular_valor_do_pai_do_item') then
    raise exception 'recalcular_valor_do_pai_do_item deixou de ser security definer';
  end if;
end $$;

commit;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Reaplicar a view de 20260511151924 §(contratos_financeiro), a função de
-- 20260905190000 e a do trigger de 20260922130000 + 20260922140000; depois:
-- alter table contratos drop column valor_final, drop column desconto,
--   drop column historico;
