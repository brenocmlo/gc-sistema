-- ============================================================
-- 007_progresso_itens_obra.sql
-- ============================================================
-- Adiciona coluna progresso_itens_pct na view `obras_com_valores`.
-- Cálculo: SUM(execucao.med_qtd) / SUM(itens.quantidade) * 100
-- agrupado por obra.
--
-- Numerador (executado): soma das quantidades MEDIDAS (etapa final
-- do pipeline fab→ent→inst→med) de todas as execuções de todos os
-- itens da obra.
-- Denominador (contratado): soma das quantidades de todos os itens.
--
-- Retorna NULL quando obra não tem itens (interpretado pela UI
-- como "sem dados pra calcular").
-- ============================================================

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
  -- Progresso de execução: % de itens medidos sobre total contratado
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
      select item_id, sum(med_qtd) as med_qtd_sum
      from execucao
      group by item_id
    ) med_por_item on med_por_item.item_id = i.id
    where i.obra_id = o.id
  ) as progresso_itens_pct
from obras o,
  lateral calcular_valores_obra(o.id) calc;

grant select on obras_com_valores to authenticated;
