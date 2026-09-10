-- ============================================================
-- SEED: 12 propostas de teste para o gc-dev
-- ============================================================
-- Roda no SQL Editor do Supabase Studio (projeto gc-dev) APÓS:
--   1. As migrations estarem aplicadas (inclusive 011, que criou
--      propostas.historico)
--   2. setup_inicial_dev.sql (criou a empresa e os perfis)
--   3. Existir ao menos UMA obra — proposta liga em obra, não em
--      cliente: a FK é composta (obra_id, empresa_id), e o cliente
--      chega por obra. Sem obra, este script insere zero linhas.
--
-- Marca todas com "[SEED-TESTE]" em observacao pra facilitar limpeza
-- (bloco no final do arquivo), igual ao seed_orcamentos.sql.
--
-- Distribui as propostas entre as obras existentes por rodízio, então
-- funciona com 1 obra ou com 20 — não depende de código de obra fixo,
-- que muda de ambiente pra ambiente.
--
-- Cobre de propósito os casos que as telas precisam mostrar:
--   - os quatro status (rascunho, enviada, aprovada, rejeitada)
--   - uma ENVIADA COM VALIDADE VENCIDA, pro selo âmbar e o filtro
--     ?vencidas=1 terem dado positivo
--   - uma sem validade (o "—" da coluna)
--   - desconto zero e desconto cheio
--   - soma de pct_* fechando 100% e soma parcial (o CHECK é <=, não =)
--   - rejeitada com motivo 'outro' + detalhe, que é o caso estrito do
--     CHECK propostas_rejeitada_motivo
--   - histórico já preenchido, pra a aba não abrir vazia
-- ============================================================

with
empresa as (
  select id from empresas order by created_at limit 1
),
obras_numeradas as (
  select o.id, o.empresa_id, row_number() over (order by o.codigo_obra) - 1 as i,
         count(*) over () as total
  from obras o
  where o.empresa_id = (select id from empresa)
),
dados as (
  select * from (values
    -- ----- RASCUNHOS (3) -----
    (0,  'PROP-2026-001', '2026-08-20', null,
     'Cobertura metálica galpão — revisão 2', 185000.00, 0.00,
     0.3000, 0.2000, 0.2500, 0.2500, 'Sinal 30%, FD 20%, entrega 25%, medição 25%',
     'rascunho', null, null, null, null,
     '[SEED-TESTE] rascunho, pct fecha 100%'),
    (1,  'PROP-2026-002', '2026-08-22', '2026-10-22',
     'Fachada ACM substituição completa', 320000.00, 20000.00,
     0.5000, 0.0000, 0.0000, 0.0000, 'Sinal 50%, resto a combinar na assinatura',
     'rascunho', null, null, null, null,
     '[SEED-TESTE] rascunho, soma parcial (CHECK é <=)'),
    (2,  'PROP-2026-003', '2026-08-25', '2026-11-25',
     'Pergolado em aço para área de espera', 42000.00, 0.00,
     0.0000, 0.0000, 0.0000, 0.0000, 'Integral na entrega',
     'rascunho', null, null, null, null,
     '[SEED-TESTE] rascunho sem percentual'),

    -- ----- ENVIADAS (4), uma delas VENCIDA -----
    (3,  'PROP-2026-004', '2026-07-10', '2026-09-30',
     'Guarda-corpo em vidro e aço inox', 67000.00, 2000.00,
     0.4000, 0.3000, 0.3000, 0.0000, null,
     'enviada', '2026-07-12', null, null, null,
     '[SEED-TESTE] enviada, validade em aberto'),
    (4,  'PROP-2026-005', '2026-06-01', '2026-07-15',
     'Mezanino metálico para estoque', 95000.00, 5000.00,
     0.3000, 0.2000, 0.2500, 0.2500, null,
     'enviada', '2026-06-03', null, null, null,
     '[SEED-TESTE] enviada VENCIDA — selo âmbar e filtro ?vencidas=1'),
    (5,  'PROP-2026-006', '2026-08-01', null,
     'Coberta para quadra poliesportiva', 215000.00, 0.00,
     0.5000, 0.0000, 0.5000, 0.0000, 'Sinal e entrega, sem FD',
     'enviada', '2026-08-05', null, null, null,
     '[SEED-TESTE] enviada SEM validade — a coluna mostra "—"'),
    (6,  'PROP-2026-007', '2026-08-15', '2026-12-15',
     'Reformulação fachada agência centro', 410000.00, 10000.00,
     0.2000, 0.2000, 0.3000, 0.3000, null,
     'enviada', '2026-08-18', null, null, null,
     '[SEED-TESTE] enviada, validade longe'),

    -- ----- APROVADAS (3) -----
    (7,  'PROP-2026-008', '2026-05-05', '2026-07-05',
     'Estrutura metálica para sobreloja', 178000.00, 8000.00,
     0.3000, 0.2000, 0.2500, 0.2500, null,
     'aprovada', '2026-05-08', '2026-06-20', null, null,
     '[SEED-TESTE] aprovada'),
    (8,  'PROP-2026-009', '2026-04-12', '2026-06-12',
     'Galpão completo 1.500m²', 680000.00, 30000.00,
     0.2000, 0.3000, 0.2500, 0.2500, 'Cronograma em 4 medições',
     'aprovada', '2026-04-15', '2026-05-30', null, null,
     '[SEED-TESTE] aprovada, valor alto'),
    (9,  'PROP-2026-010', '2026-03-20', '2026-05-20',
     'Manutenção e troca de placas ACM', 38000.00, 38000.00,
     1.0000, 0.0000, 0.0000, 0.0000, 'Cortesia contratual — desconto integral',
     'aprovada', '2026-03-22', '2026-04-10', null, null,
     '[SEED-TESTE] aprovada com desconto = valor_total (CHECK é <=)'),

    -- ----- REJEITADAS (2) -----
    (10, 'PROP-2026-011', '2026-02-10', '2026-04-10',
     'Cobertura para pátio de carga', 285000.00, 0.00,
     0.3000, 0.2000, 0.2500, 0.2500, null,
     'rejeitada', '2026-02-12', '2026-03-15', 'perdeu_concorrente', 'Concorrente "Aço Forte" venceu por preço.',
     '[SEED-TESTE] rejeitada'),
    (11, 'PROP-2026-012', '2026-01-15', '2026-03-15',
     'Substituição fachada cega lateral', 165000.00, 5000.00,
     0.5000, 0.0000, 0.5000, 0.0000, null,
     'rejeitada', '2026-01-18', '2026-02-28', 'outro', 'Cliente adiou a reforma para 2027 por questões orçamentárias.',
     '[SEED-TESTE] rejeitada com motivo "outro" + detalhe obrigatório')
  ) as v(
    ordem, numero, data_emissao, data_validade,
    descricao, valor_total, desconto,
    pct_sinal, pct_fd, pct_entrega_material, pct_medicao_instalacao,
    condicoes_pagamento,
    status, data_envio, data_decisao, motivo_rejeicao, detalhe_rejeicao,
    observacao
  )
)
insert into propostas (
  empresa_id, obra_id, numero, descricao,
  data_emissao, data_validade,
  valor_total, desconto,
  pct_sinal, pct_fd, pct_entrega_material, pct_medicao_instalacao,
  condicoes_pagamento,
  status, data_envio, data_decisao, motivo_rejeicao, detalhe_rejeicao,
  observacao, historico
)
select
  o.empresa_id,
  o.id,
  d.numero,
  d.descricao,
  d.data_emissao::date,
  d.data_validade::date,
  d.valor_total,
  d.desconto,
  d.pct_sinal, d.pct_fd, d.pct_entrega_material, d.pct_medicao_instalacao,
  d.condicoes_pagamento,
  d.status,
  d.data_envio::date,
  d.data_decisao::date,
  d.motivo_rejeicao,
  d.detalhe_rejeicao,
  d.observacao,
  -- Histórico coerente com o status, no formato de src/lib/historico.ts.
  -- `por` fica null porque seed não tem autor: a aba mostra a data e omite
  -- o nome, em vez de apontar pra um profile que não fez a mudança.
  case
    when d.status = 'rascunho' then '[]'::jsonb
    when d.status = 'enviada' then jsonb_build_array(
      jsonb_build_object(
        'de', 'rascunho', 'para', 'enviada',
        'em', (d.data_envio::date)::text || 'T12:00:00.000Z',
        'por', null, 'motivo_rejeicao', null, 'detalhe_rejeicao', null
      )
    )
    else jsonb_build_array(
      jsonb_build_object(
        'de', 'rascunho', 'para', 'enviada',
        'em', (d.data_envio::date)::text || 'T12:00:00.000Z',
        'por', null, 'motivo_rejeicao', null, 'detalhe_rejeicao', null
      ),
      jsonb_build_object(
        'de', 'enviada', 'para', d.status,
        'em', (d.data_decisao::date)::text || 'T12:00:00.000Z',
        'por', null,
        'motivo_rejeicao', d.motivo_rejeicao,
        'detalhe_rejeicao', d.detalhe_rejeicao
      )
    )
  end
from dados d
join obras_numeradas o on o.i = d.ordem % o.total
-- Idempotente pelo número, que é unique (empresa_id, numero): rodar de novo
-- não duplica nem estoura.
on conflict (empresa_id, numero) do nothing;

-- ============================================================
-- Verificação — rode junto, deve voltar 12 linhas
-- ============================================================
select
  p.numero,
  o.codigo_obra,
  c.nome as cliente,
  p.status,
  p.data_validade,
  p.valor_final,
  round((coalesce(p.pct_sinal,0) + coalesce(p.pct_fd,0)
       + coalesce(p.pct_entrega_material,0)
       + coalesce(p.pct_medicao_instalacao,0)) * 100, 2) as pct_soma,
  jsonb_array_length(p.historico) as transicoes
from propostas p
join obras o on o.id = p.obra_id
join clientes c on c.id = o.cliente_id
where p.observacao like '[SEED-TESTE]%'
order by p.numero;

-- ============================================================
-- CLEANUP — descomenta e roda quando quiser apagar os seeds:
-- ============================================================
-- delete from propostas where observacao like '[SEED-TESTE]%';
