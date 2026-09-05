-- ============================================================
-- 012_fix_calcular_valores_obra_ambiguidade.sql
-- ============================================================
-- `calcular_valores_obra` declara parâmetros OUT chamados valor_total,
-- desconto, pct_* — e, dentro do corpo, as CTEs `c_vigentes` e `todos`
-- selecionavam essas colunas SEM QUALIFICAR. Em plpgsql isso é ambíguo
-- entre a coluna da tabela e o parâmetro de saída, e o Postgres recusa
-- com 42702 ("column reference \"valor_total\" is ambiguous").
--
-- O erro é DORMENTE: só dispara no ramo em que a obra tem contrato
-- vigente ou proposta aprovada. Obra sem nenhum dos dois cai no CASO 2 e
-- passa. Por isso a migration 006 (que consertou justamente o CASO 2)
-- não expôs o problema.
--
-- Impacto: a view `obras_com_valores` chama a função via LATERAL, uma vez
-- por linha — então UMA obra com contrato derruba a listagem `/obras`
-- inteira, com a caixa vermelha de erro no lugar da tabela. Verificado em
-- gc-dev em 2026-09-05: OBRA-2025-03 tem 3 contratos ativos, e
-- `select ... from obras_com_valores` falhava para qualquer página.
--
-- Fica mais provável a partir do bloco 4.6: aprovar uma proposta pela
-- tela passa a ser possível, e proposta aprovada ativa o mesmo ramo.
--
-- Fix: qualificar todas as referências (alias em cada from, prefixo em
-- cada coluna). A lógica é idêntica à da 006 — nada de comportamento
-- muda, só o nome pelo qual cada coluna é lida.
-- ============================================================

begin;

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
      select c.valor_total, c.pct_sinal, c.pct_fd, c.pct_entrega_material,
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
      select cv.valor_total, 0::numeric as desconto, cv.pct_sinal, cv.pct_fd,
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
    -- Obra sem proposta nem contrato vigente — valores zerados (CASO 2 da 006)
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

commit;
