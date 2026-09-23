-- ============================================================
-- SEED: contratos de teste para a listagem (gc-dev)
-- ============================================================
--   bash scripts/aplicar-seed.sh supabase/seed_contratos.sql
--
-- Bloco 6.1. Os únicos contratos de gc-dev eram os três TESTE-FASE2-* da
-- automação: todos `ativo`, sem data de assinatura e sem desconto. Com eles, os
-- filtros de status e de período e a linha "final" da coluna Valor total nunca
-- aparecem na validação. Este seed cobre os quatro status:
--
--   SEED-CT-001  ativo       assinado há 10 dias,  com desconto (linha "final")
--   SEED-CT-002  suspenso    assinado há 200 dias (fora de "últimos 90 dias")
--   SEED-CT-003  concluido   assinado há 400 dias
--   SEED-CT-004  rescindido  sem data de assinatura, motivo inadimplência
--                            (o CHECK contratos_rescindido_motivo exige motivo)
--
-- Sem itens e sem proposta de origem: é só o que a listagem lê (o contrato com
-- itens e o gerado de proposta nascem e morrem na camada escrita). Idempotente
-- (`on conflict do nothing` no unique (empresa_id, numero)).
-- Marca com "[SEED-TESTE]" em observacao, igual aos outros seeds.
-- ============================================================

with
empresa as (select id from empresas order by created_at limit 1),
obra as (
  select o.id, o.empresa_id from obras o
   where o.empresa_id = (select id from empresa)
   order by o.codigo_obra limit 1
)
insert into contratos (
  empresa_id, obra_id, numero, descricao, data_assinatura, prazo_execucao,
  valor_total, desconto, status, motivo_rescisao, detalhe_rescisao,
  pct_sinal, pct_fd, pct_entrega_material, pct_medicao_instalacao,
  observacao, historico
)
select obra.empresa_id, obra.id, d.numero, d.descricao, d.assinatura, d.prazo,
       d.valor, d.desconto, d.status, d.motivo, d.detalhe,
       0.30, 0.30, 0.20, 0.20,
       '[SEED-TESTE] listagem de contratos (bloco 6.1)', '[]'::jsonb
  from obra
 cross join (values
   ('SEED-CT-001', 'Esquadrias do bloco A', current_date - 10, '60 dias corridos',
    150000.00, 5000.00, 'ativo', null, null),
   ('SEED-CT-002', 'Fachada ventilada', current_date - 200, '120 dias',
    420000.00, 0.00, 'suspenso', null, null),
   ('SEED-CT-003', 'Guarda-corpos', current_date - 400, '30 dias',
    68000.00, 0.00, 'concluido', null, null),
   ('SEED-CT-004', 'Box e espelhos', null::date, null,
    23500.00, 0.00, 'rescindido', 'inadimplencia', 'Sinal não pago')
 ) as d(numero, descricao, assinatura, prazo, valor, desconto, status, motivo, detalhe)
on conflict (empresa_id, numero) do nothing;

-- ============================================================
-- Histórico (bloco 6.6)
-- ============================================================
-- A aba Histórico do 6.5 lê `historico`, e os três contratos que não estão
-- ativos chegaram lá sem transição registrada. Uma entrada cada, no formato de
-- novaEntradaHistoricoContrato (src/lib/contratos.ts), com `por` nulo: não há
-- autor real, e a aba só mostra a data. Idempotente: só grava em histórico
-- vazio, e só nos contratos do seed.
update contratos c
   set historico = jsonb_build_array(jsonb_build_object(
         'de', 'ativo',
         'para', c.status,
         'em', to_char((coalesce(c.data_assinatura, current_date - 30) + 5)::timestamp, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
         'por', null,
         'motivo_rejeicao', null,
         'detalhe_rejeicao', null,
         'motivo_rescisao', c.motivo_rescisao,
         'detalhe_rescisao', c.detalhe_rescisao))
 where c.numero in ('SEED-CT-002', 'SEED-CT-003', 'SEED-CT-004')
   and c.observacao like '[SEED-TESTE]%'
   and c.historico = '[]'::jsonb;

-- ============================================================
-- Verificação — deve voltar 4 linhas
-- ============================================================
select numero, status, data_assinatura, valor_total, desconto, valor_final,
       jsonb_array_length(historico) as transicoes
  from contratos
 where numero like 'SEED-CT-%'
 order by numero;

-- ============================================================
-- CLEANUP (colar no SQL Editor; não roda automaticamente)
-- ============================================================
-- delete from contratos where numero like 'SEED-CT-%' and observacao like '[SEED-TESTE]%';
