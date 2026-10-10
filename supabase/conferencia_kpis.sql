-- ============================================================
-- CONFERÊNCIA: cada KPI da sprint 12 por SQL escrito à mão (gc-dev)
-- ============================================================
--   Rodado pela camada dados (validar-dados.mjs, 12.5), que troca
--   {{EMPRESA}} pela empresa do usuário da validação e compara linha a linha
--   com o que a aplicação calcula. Também roda sozinho, trocando o marcador:
--   npx supabase db query --linked --file <cópia com o uuid>
--
-- Bloco 12.5 ("conferir cada KPI contra uma consulta SQL escrita à mão").
-- Só tabelas base: nenhuma view (receitas_obra, obras_financeiro,
-- obras_com_valores) entra aqui, para a conta não herdar um erro da view.
-- As regras são as do negócio, escritas de novo:
--   * NF cancelada não fatura, não é a receber, não atrasa;
--   * pagamento de acordo convertido em NF fica arquivado, fora do recebido;
--   * parcela de acordo só é a receber se o acordo não foi cancelado nem
--     convertido, e a parcela não foi cancelada;
--   * vencer hoje ainda não é atraso (current_date em UTC, o mesmo relógio
--     do hojeISO() da aplicação).
-- Saída: uma linha por KPI, (kpi, valor). Somente leitura.
-- ============================================================

with
emp as (select '{{EMPRESA}}'::uuid as id),
hoje as (select current_date as d),
-- pagos por documento
pago_nf as (select nota_id, sum(valor) v from pagamentos where nota_id is not null group by nota_id),
pago_parc as (select parcela_acordo_id, sum(valor) v from pagamentos where parcela_acordo_id is not null group by parcela_acordo_id),
-- documentos em aberto, com saldo
nf_aberta as (
  select n.obra_id, n.data_vencimento venc, n.valor_total - coalesce(p.v, 0) saldo
    from notas_fiscais n left join pago_nf p on p.nota_id = n.id
   where n.empresa_id = (select id from emp) and n.status in ('emitida', 'paga_parcialmente')
),
parc_aberta as (
  select a.obra_id, ap.data_vencimento venc, ap.valor_previsto - coalesce(p.v, 0) saldo
    from acordo_parcelas ap join acordos_pagamento a on a.id = ap.acordo_id
    left join pago_parc p on p.parcela_acordo_id = ap.id
   where a.empresa_id = (select id from emp) and a.status = 'aberto' and ap.status in ('pendente', 'paga_parcialmente')
),
docs as (select * from nf_aberta union all select * from parc_aberta),
-- recebido válido (sem o arquivado das conversões)
pag_valido as (
  select p.obra_id, p.data_pagamento, p.valor
    from pagamentos p
    left join acordo_parcelas ap on ap.id = p.parcela_acordo_id
    left join acordos_pagamento a on a.id = ap.acordo_id
   where p.empresa_id = (select id from emp)
     and not (p.origem = 'acordo' and a.status = 'convertido_nf')
),
-- a receber bruto por obra: NFs não canceladas + parcelas válidas
bruto as (
  select obra_id, sum(v) v from (
    select obra_id, valor_total v from notas_fiscais where empresa_id = (select id from emp) and status <> 'cancelada'
    union all
    select a.obra_id, ap.valor_previsto from acordo_parcelas ap join acordos_pagamento a on a.id = ap.acordo_id
     where a.empresa_id = (select id from emp) and a.status not in ('cancelado', 'convertido_nf') and ap.status <> 'cancelada'
  ) x group by obra_id
),
receb as (select obra_id, sum(valor) v from pag_valido group by obra_id),
-- execução das obras ativas, com a etapa em que cada uma está
ex as (
  select e.*, o.id obra_id, o.codigo_obra,
         case when e.fab_qtd = 0 or e.fab_qtd < e.quantidade_total then 'fab'
              when e.ent_qtd = 0 or e.ent_qtd < e.quantidade_total then 'ent'
              when e.inst_qtd = 0 or e.inst_qtd < e.quantidade_total then 'inst'
              when e.med_qtd = 0 or e.med_qtd < e.quantidade_total then 'med' end etapa
    from execucao e join itens i on i.id = e.item_id join obras o on o.id = i.obra_id
   where o.empresa_id = (select id from emp) and o.status = 'ativa'
),
meses as (select to_char(date_trunc('month', current_date) - (n || ' month')::interval, 'YYYY-MM') mes from generate_series(0, 11) n)
select kpi, valor from (
  -- Funil e cards comerciais (12.3)
  select 'orcamentos_em_aberto' kpi, count(*)::numeric valor from orcamentos where empresa_id = (select id from emp) and status in ('pendente', 'analise', 'enviado')
  union all select 'propostas_enviadas', count(*) from propostas where empresa_id = (select id from emp) and status = 'enviada'
  union all select 'propostas_aprovadas', count(*) from propostas where empresa_id = (select id from emp) and status = 'aprovada'
  union all select 'propostas_rejeitadas', count(*) from propostas where empresa_id = (select id from emp) and status = 'rejeitada'
  -- Funil do gráfico (12.4)
  union all select 'funil_orcamentos', count(*) from orcamentos where empresa_id = (select id from emp)
  union all select 'funil_propostas', count(*) from propostas where empresa_id = (select id from emp) and status <> 'rascunho'
  union all select 'funil_contratos', count(*) from contratos where empresa_id = (select id from emp)
  -- Motivos de rejeição (12.4)
  union all select 'motivo_orcamento:' || coalesce(motivo_rejeicao, 'sem_motivo'), count(*) from orcamentos where empresa_id = (select id from emp) and status = 'rejeitado' group by motivo_rejeicao
  union all select 'motivo_proposta:' || coalesce(motivo_rejeicao, 'sem_motivo'), count(*) from propostas where empresa_id = (select id from emp) and status = 'rejeitada' group by motivo_rejeicao
  -- Pendências (12.3)
  union all select 'pend_orcamentos_pendentes', count(*) from orcamentos where empresa_id = (select id from emp) and status = 'pendente'
  union all select 'pend_propostas_vencidas', count(*) from propostas where empresa_id = (select id from emp) and status = 'enviada' and data_validade < (select d from hoje)
  union all select 'pend_documentos_revisao', count(*) from documentos_processamento where empresa_id = (select id from emp) and status = 'REVISAO_HUMANA'
  union all select 'pend_documentos_conferir', count(*) from documentos_processamento where empresa_id = (select id from emp) and status = 'APROVADO' and conferencia = 'pendente'
  union all select 'pend_fds_vencidos', count(*) from fd where empresa_id = (select id from emp) and data_pagamento is null and data_vencimento < (select d from hoje)
  union all select 'pend_documentos_vencidos', count(*) from docs where saldo > 0 and venc < (select d from hoje)
  -- Operação (12.3) e progresso (12.4)
  union all select 'obras_ativas', count(*) from obras where empresa_id = (select id from emp) and status = 'ativa'
  union all select 'execucoes_ativas', count(*) from ex
  union all select 'etapa:' || e, (select count(*) from ex where etapa = e) from unnest(array['fab', 'ent', 'inst', 'med']) e
  union all select 'execucoes_atrasadas', count(*) from ex
   where (fab_previsao_fim < (select d from hoje) and (fab_qtd = 0 or fab_qtd < quantidade_total))
      or (ent_previsao_fim < (select d from hoje) and (ent_qtd = 0 or ent_qtd < quantidade_total))
      or (inst_previsao_fim < (select d from hoje) and (inst_qtd = 0 or inst_qtd < quantidade_total))
      or (med_previsao_fim < (select d from hoje) and (med_qtd = 0 or med_qtd < quantidade_total))
  union all select 'progresso:' || codigo_obra, round((
      least(sum(fab_qtd) / nullif(sum(quantidade_total), 0), 1) + least(sum(ent_qtd) / nullif(sum(quantidade_total), 0), 1)
    + least(sum(inst_qtd) / nullif(sum(quantidade_total), 0), 1) + least(sum(med_qtd) / nullif(sum(quantidade_total), 0), 1)) * 25, 2)
    from ex group by codigo_obra
  -- Financeiro da empresa (12.2 e 12.3)
  union all select 'a_receber', coalesce((select sum(coalesce(b.v, 0) - coalesce(r.v, 0)) from obras o left join bruto b on b.obra_id = o.id left join receb r on r.obra_id = o.id where o.empresa_id = (select id from emp)), 0)
  union all select 'recebido_mes', coalesce(sum(valor), 0) from pag_valido where data_pagamento >= date_trunc('month', current_date)::date
  union all select 'atrasado', coalesce(sum(saldo), 0) from docs where saldo > 0 and venc < (select d from hoje)
  union all select 'previsto_30', coalesce(sum(saldo), 0) from docs where saldo > 0 and venc between (select d from hoje) and (select d from hoje) + 30
  -- Receita por mês (12.4)
  union all select 'recebido:' || m.mes, coalesce((select sum(valor) from pag_valido where to_char(data_pagamento, 'YYYY-MM') = m.mes), 0) from meses m
  union all select 'faturado:' || m.mes, coalesce((select sum(valor_total) from notas_fiscais where empresa_id = (select id from emp) and status <> 'cancelada' and to_char(data_emissao, 'YYYY-MM') = m.mes), 0) from meses m
  -- Aba Financeiro de cada obra (12.1)
  union all select 'obra_faturado:' || o.codigo_obra, coalesce((select sum(valor_total) from notas_fiscais where obra_id = o.id and status <> 'cancelada'), 0) from obras o where o.empresa_id = (select id from emp)
  union all select 'obra_recebido:' || o.codigo_obra, coalesce((select v from receb where obra_id = o.id), 0) from obras o where o.empresa_id = (select id from emp)
  union all select 'obra_a_receber:' || o.codigo_obra, coalesce((select v from bruto where obra_id = o.id), 0) - coalesce((select v from receb where obra_id = o.id), 0) from obras o where o.empresa_id = (select id from emp)
  union all select 'obra_atrasado:' || o.codigo_obra, coalesce((select sum(saldo) from docs where obra_id = o.id and saldo > 0 and venc < (select d from hoje)), 0) from obras o where o.empresa_id = (select id from emp)
  union all select 'obra_fd_descontado:' || o.codigo_obra, coalesce((select sum(valor_descontar) from fd where obra_id = o.id), 0) from obras o where o.empresa_id = (select id from emp)
  union all select 'obra_arquivado:' || o.codigo_obra, coalesce((select sum(p.valor) from pagamentos p join acordo_parcelas ap on ap.id = p.parcela_acordo_id join acordos_pagamento a on a.id = ap.acordo_id where p.obra_id = o.id and p.origem = 'acordo' and a.status = 'convertido_nf'), 0) from obras o where o.empresa_id = (select id from emp)
) k
order by kpi;
