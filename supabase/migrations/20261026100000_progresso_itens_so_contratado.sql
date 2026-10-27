-- ============================================================
-- 20261026100000_progresso_itens_so_contratado.sql
-- ============================================================
-- Corrige `obras_com_valores.progresso_itens_pct` (criada em
-- 20260512151918_progresso_itens_obra.sql e não redefinida desde então).
--
-- DEFEITO: o denominador somava a quantidade de TODOS os itens da obra, de
-- proposta e de contrato. Desde o bloco 6.2, `gerar_contrato_de_proposta`
-- COPIA os itens da proposta para o contrato (a proposta fica com os dela),
-- e a execução só aceita item de contrato vigente (7.2, `execucao/actions.ts`).
-- Resultado: obra com contrato gerado tinha o denominador em dobro e o
-- progresso parava em 50% com tudo medido. Também contavam itens de
-- proposta em rascunho e de contrato rescindido. Achado na revisão do 14.1.
--
-- REGRA NOVA: progresso = medido / CONTRATADO × 100, e "contratado" é o mesmo
-- conjunto que `calcular_valores_obra` usa para o valor da obra:
--   * itens dos contratos não rescindidos da obra; e
--   * itens das propostas `aprovada` sem contrato não rescindido gerado delas
--     (`contratos.proposta_origem_id`).
-- O numerador só soma a medição desses itens. NULL quando o contratado soma
-- zero (a UI mostra "sem dados"). Espelho em TypeScript, com teste:
-- `src/lib/progresso-obra.ts`.
--
-- A view continua `security_invoker`: as subconsultas passam pela RLS de
-- quem lê, como `calcular_valores_obra`. Colunas e ordem não mudam (o `o.*`
-- é o mesmo de antes), então `create or replace` basta e os types gerados
-- não mudam. Idempotente.
-- ============================================================

begin;

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
  calc.fonte as fonte_valores,
  -- Progresso de execução: % medido sobre o contratado (regra acima)
  (
    select case
      when sum(i.quantidade) > 0
      then round(
        sum(coalesce(med_por_item.med_qtd_sum, 0)) / sum(i.quantidade) * 100,
        2
      )::numeric
      else null
    end
    from itens i
    left join (
      select e.item_id, sum(e.med_qtd) as med_qtd_sum
      from execucao e
      group by e.item_id
    ) med_por_item on med_por_item.item_id = i.id
    where i.obra_id = o.id
      and (
        -- item de contrato vigente
        exists (
          select 1 from contratos c
          where c.id = i.contrato_id and c.status <> 'rescindido'
        )
        or
        -- item de proposta aprovada que ainda não virou contrato vigente
        exists (
          select 1 from propostas p
          where p.id = i.proposta_id
            and p.status = 'aprovada'
            and not exists (
              select 1 from contratos c2
              where c2.proposta_origem_id = p.id and c2.status <> 'rescindido'
            )
        )
      )
  ) as progresso_itens_pct
from obras o,
  lateral calcular_valores_obra(o.id) calc;

grant select on obras_com_valores to authenticated;

commit;
