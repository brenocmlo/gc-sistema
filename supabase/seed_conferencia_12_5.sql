-- ============================================================
-- SEED: a obra com FD, acordo convertido e NF cancelada ao mesmo tempo (gc-dev)
-- ============================================================
--   bash scripts/banco/aplicar-seed.sh supabase/seed_conferencia_12_5.sql
--
-- Bloco 12.5 ("testar com uma obra que tenha FD, acordo convertido e NF
-- cancelada ao mesmo tempo"). A obra do SEED-CT-EXEC-45 já tem os dois
-- primeiros: os FDs do seed_execucao.sql (2.900 a descontar) e o SEED-AC-005,
-- convertido na NF de saldo SEED-CONV-001 (seed_acordos.sql). Falta a NF
-- cancelada, que entra aqui:
--
--   SEED-NF-CANC-45/1  medicao  2.500,00  cancelada, com motivo, vencida há
--                      10 dias (se não estivesse cancelada, seria atrasada)
--
-- Os três casos têm de ficar FORA dos números: a NF cancelada não fatura, não
-- entra no a receber nem no atrasado; o pagamento do acordo convertido fica
-- arquivado, fora do recebido; o FD entra só no "FD descontado". Por isso os
-- totais da obra que a sprint 12 confere (a receber 3.900, recebido 6.500,
-- atrasado 1.200, faturado 1.500) NÃO mudam com este seed.
-- Idempotente (unique da NF; o documento e o FD pelo código). Marca "[SEED-TESTE]".
-- ============================================================

with alvo as (
  select c.id as contrato_id, c.empresa_id, c.obra_id from contratos c
   where c.numero = 'SEED-CT-EXEC-45' and c.observacao like '[SEED-TESTE]%'
)
insert into notas_fiscais (empresa_id, obra_id, contrato_id, numero, serie, data_emissao, data_vencimento,
                           tipo, valor_total, status, motivo_cancelamento, data_cancelamento, observacao)
select a.empresa_id, a.obra_id, a.contrato_id, 'SEED-NF-CANC-45', '1', current_date - 20, current_date - 10,
       'medicao', 2500.00, 'cancelada', 'Medição emitida em duplicidade; cancelada', current_date - 15,
       '[SEED-TESTE] NF cancelada da obra com FD e acordo convertido (12.5)'
  from alvo a
on conflict do nothing;

-- Pendências que voltavam zero em gc-dev (12.3): sem elas, o dashboard nunca
-- mostrava "Documentos lançados a conferir" nem "FDs vencidos sem pagamento".
--
--   SEED-DOC-CONF  documento da automação REGISTRADO e a conferir
--                  (status APROVADO, conferencia pendente), sem registro
--                  criado: um "Não aceitar" pela tela não apaga nada de seed
--   SEED-FD-VENC   FD sem pagamento, vencido há 5 dias, na obra concluída
--                  (OBRA-2027-01), que nenhuma checagem fixa
do $$
declare v_emp uuid; v_obra uuid; v_obra2 uuid; v_rev uuid;
begin
  select c.empresa_id, c.obra_id into v_emp, v_obra from contratos c
   where c.numero = 'SEED-CT-EXEC-45' and c.observacao like '[SEED-TESTE]%';
  if v_emp is null then raise exception 'SEED-CT-EXEC-45 ausente: aplique supabase/seed_execucao.sql antes'; end if;
  select id into v_rev from profiles where empresa_id = v_emp and perfil = 'admin' and ativo order by created_at limit 1;

  if not exists (select 1 from documentos_processamento where numero_contrato = 'SEED-DOC-CONF') then
    insert into documentos_processamento (empresa_id, tipo_documento, arquivo_url, status, obra_id, numero_contrato,
                                          motivo_revisao, etapa, conferencia, revisado_por, revisado_em)
    values (v_emp, 'PROPOSTA', 'seed://SEED-DOC-CONF.pdf', 'APROVADO', v_obra, 'SEED-DOC-CONF',
            '[SEED-TESTE] registrado pelo bot, a conferir (12.5)', 'CONCLUIDO', 'pendente', v_rev, now());
  end if;

  select id into v_obra2 from obras where empresa_id = v_emp and codigo_obra = 'OBRA-2027-01';
  if v_obra2 is not null and not exists (select 1 from fd where codigo = 'SEED-FD-VENC') then
    insert into fd (empresa_id, obra_id, codigo, fornecedor, pedido_documento, especificacao, data_lancamento,
                    data_vencimento, valor, valor_descontar, observacao)
    values (v_emp, v_obra2, 'SEED-FD-VENC', 'Fornecedor de Teste Ltda', 'SEED-PED-12.5', 'Perfil de alumínio',
            current_date - 20, current_date - 5, 640.00, 640.00, '[SEED-TESTE] FD vencido sem pagamento (12.5)');
  end if;
end $$;

-- Conferência: a obra tem as três situações.
select o.codigo_obra,
       (select count(*) from fd where obra_id = o.id) as fds,
       (select count(*) from acordos_pagamento where obra_id = o.id and status = 'convertido_nf') as acordos_convertidos,
       (select count(*) from notas_fiscais where obra_id = o.id and status = 'cancelada') as nfs_canceladas
       , (select count(*) from documentos_processamento where status = 'APROVADO' and conferencia = 'pendente') as docs_a_conferir
       , (select count(*) from fd where data_pagamento is null and data_vencimento < current_date) as fds_vencidos
  from obras o
 where o.id = (select obra_id from contratos where numero = 'SEED-CT-EXEC-45');
