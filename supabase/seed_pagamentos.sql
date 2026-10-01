-- ============================================================
-- SEED: pagamentos das três origens (gc-dev)
-- ============================================================
--   bash scripts/banco/aplicar-seed.sh supabase/seed_pagamentos.sql
--
-- Sprint 10 (adiantado no 10.1, é atividade do 10.6). gc-dev só tinha os três
-- pagamentos de NF do seed_notas_fiscais.sql: a listagem sairia sem acordo e
-- sem avulso. Na obra do SEED-CT-EXEC:
--
--   SEED-AC-001  acordo "Sinal outubro" com 2 parcelas (sprint 11 faz a tela)
--     parcela 1  3.000, paga por inteiro   → pagamento origem 'acordo', pix
--     parcela 2  2.000, sem pagamento      → continua pendente
--   avulso       1.500, dinheiro, há 5 dias, com observação
--   avulso         350, cartão, há 50 dias, com observação
--
-- Com os três de NF (003: 2.000; 004: 1.200 + 800), a obra fica com 6
-- pagamentos, as três origens e 6 formas diferentes.
-- Idempotente: o acordo pela descrição, os avulsos pela observação.
-- Marca com "[SEED-TESTE]" em observacao, igual aos outros seeds.
-- ============================================================

with alvo as (
  select c.empresa_id, c.obra_id from contratos c
   where c.numero = 'SEED-CT-EXEC' and c.observacao like '[SEED-TESTE]%'
)
insert into acordos_pagamento (empresa_id, obra_id, descricao, motivo, periodo_ref, data_abertura, observacao)
select a.empresa_id, a.obra_id, 'SEED-AC-001 Sinal outubro', 'sinal', 'Outubro/2026', current_date - 20,
       '[SEED-TESTE] acordo de pagamento (sprint 10)'
  from alvo a
 where not exists (select 1 from acordos_pagamento where descricao = 'SEED-AC-001 Sinal outubro');

insert into acordo_parcelas (empresa_id, acordo_id, obra_id, numero_parcela, data_vencimento, valor_previsto, observacao)
select ac.empresa_id, ac.id, ac.obra_id, d.n, current_date + d.vence_em, d.valor, '[SEED-TESTE] parcela (sprint 10)'
  from acordos_pagamento ac
 cross join (values (1, -10, 3000.00), (2, 20, 2000.00)) as d(n, vence_em, valor)
 where ac.descricao = 'SEED-AC-001 Sinal outubro'
   and not exists (select 1 from acordo_parcelas p where p.acordo_id = ac.id and p.numero_parcela = d.n);

-- Parcela 1 paga por inteiro. O trigger do pagamento recalcula o status dela.
insert into pagamentos (empresa_id, obra_id, parcela_acordo_id, origem, valor, data_pagamento, forma, observacao)
select p.empresa_id, p.obra_id, p.id, 'acordo', 3000.00, current_date - 12, 'pix',
       '[SEED-TESTE] pagamento de acordo (sprint 10)'
  from acordo_parcelas p
  join acordos_pagamento ac on ac.id = p.acordo_id
 where ac.descricao = 'SEED-AC-001 Sinal outubro' and p.numero_parcela = 1
   and not exists (select 1 from pagamentos pg where pg.parcela_acordo_id = p.id);

with alvo as (
  select c.empresa_id, c.obra_id from contratos c
   where c.numero = 'SEED-CT-EXEC' and c.observacao like '[SEED-TESTE]%'
)
insert into pagamentos (empresa_id, obra_id, origem, valor, data_pagamento, forma, observacao)
select a.empresa_id, a.obra_id, 'avulso', d.valor, current_date - d.ha, d.forma, d.obs
  from alvo a
 cross join (values
   (1500.00, 5,  'dinheiro', '[SEED-TESTE] avulso: adiantamento em espécie na obra'),
   ( 350.00, 50, 'cartao',   '[SEED-TESTE] avulso: taxa de visita técnica')
 ) as d(valor, ha, forma, obs)
 where not exists (select 1 from pagamentos pg where pg.observacao = d.obs);

-- ============================================================
-- Verificação — 6 pagamentos na obra: 3 de NF, 1 de acordo, 2 avulsos; a
-- parcela 1 paga e a 2 pendente
-- ============================================================
select pg.origem, pg.forma, pg.valor, pg.data_pagamento,
       coalesce('NF ' || nf.numero, ac.descricao || ' · parcela ' || pa.numero_parcela, '—') as documento,
       pa.status as status_parcela
  from pagamentos pg
  left join notas_fiscais nf on nf.id = pg.nota_id
  left join acordo_parcelas pa on pa.id = pg.parcela_acordo_id
  left join acordos_pagamento ac on ac.id = pa.acordo_id
 where pg.observacao like '[SEED-TESTE]%'
 order by pg.data_pagamento desc;

-- ============================================================
-- CLEANUP (colar no SQL Editor; não roda automaticamente)
-- ============================================================
-- delete from pagamentos where observacao like '[SEED-TESTE] avulso:%' or observacao = '[SEED-TESTE] pagamento de acordo (sprint 10)';
-- delete from acordos_pagamento where descricao = 'SEED-AC-001 Sinal outubro';  -- parcelas saem em cascata
