-- ============================================================
-- SEED: acordos de pagamento nos quatro status de tela (gc-dev)
-- ============================================================
--   bash scripts/banco/aplicar-seed.sh supabase/seed_acordos.sql
--
-- Sprint 11 (adiantado no 11.1; é atividade do 11.5). gc-dev só tinha o
-- SEED-AC-001 (aberto, do seed_pagamentos.sql), e a listagem sairia sem
-- quitado, sem cancelado e sem parcela atrasada. Na obra do SEED-CT-EXEC-45 (a
-- segunda obra do seed_execucao.sql), para não mexer nos totais da obra do
-- SEED-CT-EXEC, que as checagens da sprint 10 conferem:
--
--   SEED-AC-002  adiantamento_material, contrato SEED-CT-EXEC-45, 2 parcelas
--                pagas (pix e TED) → as parcelas e o acordo vão a quitado pelos
--                triggers (10.5)
--   SEED-AC-003  aditivo_informal, cancelado, com data_encerramento, 1 parcela
--                cancelada
--   SEED-AC-004  emergencial, aberto: parcela 1 vencida há 7 dias sem pagamento
--                (ATRASADA na tela), parcela 2 a vencer, parcela 3 cancelada
--
--   SEED-AC-005  sinal, CONVERTIDO EM NF (11.4): 2 parcelas de 1.500, a 1 paga
--                (pix) antes da conversão; a NF de saldo SEED-CONV-001, de
--                1.500, emitida. O pagamento fica arquivado nas views.
-- Idempotente pela descrição. Marca com "[SEED-TESTE]" em observacao.
-- ============================================================

with alvo as (
  select c.empresa_id, c.obra_id, c.id as contrato_id from contratos c
   where c.numero = 'SEED-CT-EXEC-45' and c.observacao like '[SEED-TESTE]%'
)
insert into acordos_pagamento (empresa_id, obra_id, contrato_id, descricao, motivo, periodo_ref, data_abertura,
                               status, data_encerramento, observacao)
select a.empresa_id, a.obra_id, case when d.com_contrato then a.contrato_id end, d.descricao, d.motivo, d.periodo,
       current_date - d.aberto_ha, d.status, case when d.status = 'cancelado' then current_date - 3 end,
       '[SEED-TESTE] acordo de pagamento (sprint 11)'
  from alvo a
 cross join (values
   ('SEED-AC-002 Adiantamento de vidros', 'adiantamento_material', 'Setembro/2026', 40, 'aberto',    true),
   ('SEED-AC-003 Aditivo da cobertura',   'aditivo_informal',      'Agosto/2026',   60, 'cancelado', false),
   ('SEED-AC-004 Troca emergencial',      'emergencial',           'Outubro/2026',  15, 'aberto',    false),
   ('SEED-AC-005 Sinal convertido',       'sinal',                 'Setembro/2026', 35, 'aberto',    false)
 ) as d(descricao, motivo, periodo, aberto_ha, status, com_contrato)
 where not exists (select 1 from acordos_pagamento where descricao = d.descricao);

insert into acordo_parcelas (empresa_id, acordo_id, obra_id, numero_parcela, data_vencimento, valor_previsto, status, observacao)
select ac.empresa_id, ac.id, ac.obra_id, d.n, current_date + d.vence_em, d.valor, d.status, '[SEED-TESTE] parcela (sprint 11)'
  from acordos_pagamento ac
  join (values
    ('SEED-AC-002 Adiantamento de vidros', 1, -30, 4000.00, 'pendente'),
    ('SEED-AC-002 Adiantamento de vidros', 2, -10, 2500.00, 'pendente'),
    ('SEED-AC-003 Aditivo da cobertura',   1,  10, 1800.00, 'cancelada'),
    ('SEED-AC-004 Troca emergencial',      1,  -7, 1200.00, 'pendente'),
    ('SEED-AC-004 Troca emergencial',      2,  23, 1200.00, 'pendente'),
    ('SEED-AC-004 Troca emergencial',      3,  53,  600.00, 'cancelada'),
    ('SEED-AC-005 Sinal convertido',       1, -20, 1500.00, 'pendente'),
    ('SEED-AC-005 Sinal convertido',       2,  10, 1500.00, 'pendente')
  ) as d(descricao, n, vence_em, valor, status) on d.descricao = ac.descricao
 where not exists (select 1 from acordo_parcelas p where p.acordo_id = ac.id and p.numero_parcela = d.n);

-- As duas parcelas do SEED-AC-002 pagas por inteiro: o trigger põe as parcelas
-- e o acordo como quitado (data_encerramento, hoje).
insert into pagamentos (empresa_id, obra_id, parcela_acordo_id, origem, valor, data_pagamento, forma, observacao)
select p.empresa_id, p.obra_id, p.id, 'acordo', p.valor_previsto, p.data_vencimento, d.forma,
       '[SEED-TESTE] pagamento de acordo (sprint 11)'
  from acordo_parcelas p
  join acordos_pagamento ac on ac.id = p.acordo_id
  join (values (1, 'pix'), (2, 'ted')) as d(n, forma) on d.n = p.numero_parcela
 where ac.descricao = 'SEED-AC-002 Adiantamento de vidros'
   and not exists (select 1 from pagamentos pg where pg.parcela_acordo_id = p.id);

-- SEED-AC-005: a parcela 1 paga, e depois a conversão na NF de saldo (o que a
-- RPC converter_acordo_em_nf faz, sem a sessão que a RPC exige).
insert into pagamentos (empresa_id, obra_id, parcela_acordo_id, origem, valor, data_pagamento, forma, observacao)
select p.empresa_id, p.obra_id, p.id, 'acordo', 1500.00, current_date - 18, 'pix', '[SEED-TESTE] pagamento de acordo convertido (sprint 11)'
  from acordo_parcelas p
  join acordos_pagamento ac on ac.id = p.acordo_id
 where ac.descricao = 'SEED-AC-005 Sinal convertido' and p.numero_parcela = 1 and ac.status = 'aberto'
   and not exists (select 1 from pagamentos pg where pg.parcela_acordo_id = p.id);

insert into notas_fiscais (empresa_id, obra_id, numero, serie, tipo, data_emissao, valor_total, status, observacao)
select ac.empresa_id, ac.obra_id, 'SEED-CONV-001', '1', 'sinal', current_date - 5, 1500.00, 'emitida',
       '[SEED-TESTE] NF de saldo do SEED-AC-005 (sprint 11)'
  from acordos_pagamento ac
 where ac.descricao = 'SEED-AC-005 Sinal convertido'
   and not exists (select 1 from notas_fiscais where numero = 'SEED-CONV-001');

update acordos_pagamento ac
   set status = 'convertido_nf', data_encerramento = current_date - 5,
       nf_convertida_id = (select id from notas_fiscais where numero = 'SEED-CONV-001')
 where ac.descricao = 'SEED-AC-005 Sinal convertido' and ac.status = 'aberto';

-- ============================================================
-- Verificação — 4 acordos: 002 quitado (parcelas pagas), 003 cancelado,
-- 004 aberto com a parcela 1 vencida e a 3 cancelada, 005 convertido com a
-- parcela 1 paga
-- ============================================================
select ac.descricao, ac.status as acordo, ac.data_encerramento is not null as encerrado,
       p.numero_parcela, p.data_vencimento, p.valor_previsto, p.status as parcela,
       coalesce((select sum(valor) from pagamentos pg where pg.parcela_acordo_id = p.id), 0) as pago
  from acordos_pagamento ac
  join acordo_parcelas p on p.acordo_id = ac.id
 where ac.descricao like 'SEED-AC-00%' and ac.descricao <> 'SEED-AC-001 Sinal outubro'
 order by ac.descricao, p.numero_parcela;

-- ============================================================
-- CLEANUP (colar no SQL Editor; não roda automaticamente)
-- ============================================================
-- delete from pagamentos where observacao = '[SEED-TESTE] pagamento de acordo (sprint 11)';
-- delete from pagamentos where observacao = '[SEED-TESTE] pagamento de acordo convertido (sprint 11)';
-- delete from acordos_pagamento where descricao in ('SEED-AC-002 Adiantamento de vidros', 'SEED-AC-003 Aditivo da cobertura', 'SEED-AC-004 Troca emergencial', 'SEED-AC-005 Sinal convertido');
-- delete from notas_fiscais where numero = 'SEED-CONV-001';
