-- ============================================================
-- 006_fix_calcular_valores_obra.sql
-- ============================================================
-- A função `calcular_valores_obra` foi escrita assumindo que a
-- tabela `obras` ainda tinha os campos legacy (valor_total,
-- desconto, valor_final, pct_*, forma_pagamento). A migration 004
-- dropou todos esses campos — então o CASO 2 (obra sem proposta
-- nem contrato vigente) quebra a listagem inteira (a view
-- `obras_com_valores` chama essa função via LATERAL).
--
-- Fix: o CASO 2 agora retorna zeros + fonte='sem_proposta'.
-- CASO 1 (com proposta/contrato) continua igual.
-- ============================================================

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
    select 1 from contratos
    where obra_id = p_obra_id and status != 'rescindido'
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
      select valor_total, pct_sinal, pct_fd, pct_entrega_material,
             pct_medicao_instalacao, condicoes_pagamento
      from contratos
      where obra_id = p_obra_id and status != 'rescindido'
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
      select valor_total, 0::numeric as desconto, pct_sinal, pct_fd,
             pct_entrega_material, pct_medicao_instalacao, condicoes_pagamento
      from c_vigentes
      union all
      select valor_total, desconto, pct_sinal, pct_fd,
             pct_entrega_material, pct_medicao_instalacao, condicoes_pagamento
      from p_aprovadas_sem_contrato
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
    -- Obra sem proposta nem contrato vigente — valores zerados
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
