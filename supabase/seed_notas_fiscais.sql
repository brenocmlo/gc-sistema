-- ============================================================
-- SEED: notas fiscais em situações diferentes (gc-dev)
-- ============================================================
--   bash scripts/banco/aplicar-seed.sh supabase/seed_notas_fiscais.sql
--
-- Sprint 9 (adiantado no 9.1, completado no 9.6). gc-dev não tinha nenhuma NF
-- nem pagamento, e a listagem sairia "não exercitada". Seis NFs na obra do
-- SEED-CT-EXEC, com os seis tipos e as cinco situações da tela:
--
--   SEED-NF-001/1  sinal             emitida, vence daqui a 20 dias, contrato SEED-CT-001
--   SEED-NF-002/1  entrega_material  VENCIDA (emitida, venceu há 5 dias), contrato SEED-CT-001
--   SEED-NF-003/1  medicao           paga parcialmente (40% pago), contrato SEED-CT-EXEC
--   SEED-NF-004    instalacao        paga (100% em 2 pagamentos), sem série, sem vínculo
--   SEED-NF-005/1  fat_direto        cancelada, com motivo (CHECK nf_cancelada_motivo)
--   SEED-NF-006/2  outro             emitida, sem vencimento, chave NF-e de 44 dígitos
--
-- Os pagamentos entram com origem 'nf', e o trigger atualizar_status_nf_by_id
-- muda o status (paga_parcialmente / paga). A NF cancelada não recebe
-- pagamento: o trigger não a sobrescreve, mas a tela não deve oferecer.
-- Idempotente pelo unique (empresa_id, numero, serie).
-- Marca com "[SEED-TESTE]" em observacao, igual aos outros seeds.
-- ============================================================

with
alvo as (
  select c.empresa_id, c.obra_id from contratos c
   where c.numero = 'SEED-CT-EXEC' and c.observacao like '[SEED-TESTE]%'
),
ct as (select id, numero from contratos where numero in ('SEED-CT-001', 'SEED-CT-EXEC'))
insert into notas_fiscais (empresa_id, obra_id, contrato_id, numero, serie, chave_nfe,
                           data_emissao, data_vencimento, tipo, valor_total, status,
                           motivo_cancelamento, data_cancelamento, observacao)
select a.empresa_id, a.obra_id,
       (select id from ct where ct.numero = d.contrato and d.contrato is not null
          and (select obra_id from contratos where id = ct.id) = a.obra_id),
       d.numero, d.serie, d.chave, current_date - d.emitida_ha, current_date + d.vence_em,
       d.tipo, d.valor, d.status, d.motivo, case when d.motivo is null then null else current_date - 3 end,
       '[SEED-TESTE] notas fiscais (sprint 9)'
  from alvo a
 cross join (values
   ('SEED-NF-001', '1',  null::text,                                        10, 20,   'sinal',            3000.00, 'emitida',   null::text,             'SEED-CT-001'),
   ('SEED-NF-002', '1',  null,                                              40, -5,   'entrega_material', 4500.00, 'emitida',   null,                   'SEED-CT-001'),
   ('SEED-NF-003', '1',  null,                                              30, 15,   'medicao',          5000.00, 'emitida',   null,                   'SEED-CT-EXEC'),
   ('SEED-NF-004', null, null,                                              60, -30,  'instalacao',       2000.00, 'emitida',   null,                   null),
   ('SEED-NF-005', '1',  null,                                              20, 10,   'fat_direto',       1200.00, 'cancelada', 'Emitida com valor errado; substituída', null),
   ('SEED-NF-006', '2',  '35260912345678000190550020000000061234567890',    5,  null, 'outro',             800.00, 'emitida',   null,                   null)
 ) as d(numero, serie, chave, emitida_ha, vence_em, tipo, valor, status, motivo, contrato)
on conflict do nothing;

-- Pagamentos: 40% da 003 e 100% da 004 em duas vezes. Só se a NF ainda não
-- tem pagamento (reaplicar não duplica).
insert into pagamentos (empresa_id, obra_id, nota_id, origem, valor, data_pagamento, forma, observacao)
select nf.empresa_id, nf.obra_id, nf.id, 'nf', d.valor, current_date - d.ha, d.forma, '[SEED-TESTE] pagamento de NF (sprint 9)'
  from notas_fiscais nf
  join (values
    ('SEED-NF-003', 2000.00, 10, 'pix'),
    ('SEED-NF-004', 1200.00, 40, 'ted'),
    ('SEED-NF-004',  800.00, 20, 'boleto')
  ) as d(numero, valor, ha, forma) on d.numero = nf.numero
 where nf.observacao like '[SEED-TESTE]%'
   and not exists (select 1 from pagamentos p where p.nota_id = nf.id);

-- ============================================================
-- Verificação — 6 linhas: 002 emitida com vencimento passado, 003
-- paga_parcialmente com 2000 recebidos, 004 paga com 2000, 005 cancelada
-- ============================================================
select nf.numero, nf.serie, nf.tipo, nf.status, nf.data_vencimento, nf.valor_total,
       coalesce((select sum(valor) from pagamentos p where p.nota_id = nf.id), 0) as recebido,
       (select numero from contratos c where c.id = nf.contrato_id) as contrato
  from notas_fiscais nf
 where nf.numero like 'SEED-NF-%'
 order by nf.numero;

-- ============================================================
-- CLEANUP (colar no SQL Editor; não roda automaticamente)
-- ============================================================
-- delete from pagamentos where nota_id in (select id from notas_fiscais where numero like 'SEED-NF-%' and observacao like '[SEED-TESTE]%');
-- delete from notas_fiscais where numero like 'SEED-NF-%' and observacao like '[SEED-TESTE]%';
