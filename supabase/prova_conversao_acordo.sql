-- ============================================================
-- PROVA: a conversão de acordo em NF e o efeito nas views (gc-dev)
-- ============================================================
--   npx supabase db query --linked --file supabase/prova_conversao_acordo.sql
--
-- Bloco 11.4 ("testar o efeito na view receitas_obra antes e depois da
-- conversão"). Roda numa transação e DESFAZ no fim. Na obra do SEED-CT-EXEC:
-- um acordo de 2 parcelas de 1.000, com 400 pagos, convertido numa NF de
-- saldo de 1.600 pela RPC converter_acordo_em_nf (migration 037). Compara
-- receitas_obra e obras_financeiro antes e depois.
--
-- A regra 7: o a receber troca as parcelas (2.000) pela NF (1.600); o
-- recebido perde os 400, que vão para o arquivado; e o SALDO DA OBRA NÃO
-- MUDA — é por isso que a NF de saldo vale o que falta, e não o total.
-- `ok` tem de ser true em todas as linhas.
-- ============================================================

begin;

create temp table prova (passo int, o_que text, esperado text, obtido text, ok boolean) on commit drop;

do $$
declare
  v_emp uuid; v_obra uuid; v_acordo uuid; v_p1 uuid; v_p2 uuid; v_nf uuid;
  a receitas_obra%rowtype; d receitas_obra%rowtype;
  fa obras_financeiro%rowtype; fd obras_financeiro%rowtype;
  v_acordo_row acordos_pagamento%rowtype;
  v_erro text;
begin
  select c.empresa_id, c.obra_id into v_emp, v_obra from contratos c where c.numero = 'SEED-CT-EXEC';
  if v_emp is null then raise exception 'SEED-CT-EXEC ausente'; end if;

  insert into acordos_pagamento (empresa_id, obra_id, descricao, motivo) values (v_emp, v_obra, 'PROVA-11.4-AC', 'sinal') returning id into v_acordo;
  insert into acordo_parcelas (empresa_id, acordo_id, obra_id, numero_parcela, data_vencimento, valor_previsto)
  values (v_emp, v_acordo, v_obra, 1, current_date, 1000) returning id into v_p1;
  insert into acordo_parcelas (empresa_id, acordo_id, obra_id, numero_parcela, data_vencimento, valor_previsto)
  values (v_emp, v_acordo, v_obra, 2, current_date + 30, 1000) returning id into v_p2;
  insert into pagamentos (empresa_id, obra_id, origem, parcela_acordo_id, valor, observacao)
  values (v_emp, v_obra, 'acordo', v_p1, 400, 'PROVA-11.4');

  select * into a from receitas_obra where obra_id = v_obra;
  select * into fa from obras_financeiro where obra_id = v_obra;

  v_nf := converter_acordo_em_nf(v_acordo, 'PROVA-11.4-NF', 'sinal', 1600);

  select * into d from receitas_obra where obra_id = v_obra;
  select * into fd from obras_financeiro where obra_id = v_obra;
  select * into v_acordo_row from acordos_pagamento where id = v_acordo;

  insert into prova values
    (1, 'acordo convertido, com a NF e a data de encerramento', 'convertido_nf',
        v_acordo_row.status || ' / nf ' || (v_acordo_row.nf_convertida_id = v_nf)::text || ' / enc ' || (v_acordo_row.data_encerramento is not null)::text,
        v_acordo_row.status = 'convertido_nf' and v_acordo_row.nf_convertida_id = v_nf and v_acordo_row.data_encerramento is not null),
    (2, 'NF de saldo emitida, na obra do acordo', 'emitida / 1600',
        (select status || ' / ' || valor_total from notas_fiscais where id = v_nf),
        (select status = 'emitida' and valor_total = 1600 and obra_id = v_obra from notas_fiscais where id = v_nf)),
    (3, 'receitas_obra.total_acordos: as 2 parcelas saem', (a.total_acordos - 2000)::text, d.total_acordos::text, d.total_acordos = a.total_acordos - 2000),
    (4, 'receitas_obra.total_nfs_emitidas: a NF de saldo entra', (a.total_nfs_emitidas + 1600)::text, d.total_nfs_emitidas::text, d.total_nfs_emitidas = a.total_nfs_emitidas + 1600),
    (5, 'receitas_obra.total_a_receber: troca 2.000 por 1.600', (a.total_a_receber - 400)::text, d.total_a_receber::text, d.total_a_receber = a.total_a_receber - 400),
    (6, 'receitas_obra.total_recebido: os 400 saem', (a.total_recebido - 400)::text, d.total_recebido::text, d.total_recebido = a.total_recebido - 400),
    (7, 'receitas_obra.total_acordos_convertidos_arquivado: os 400 entram', (a.total_acordos_convertidos_arquivado + 400)::text, d.total_acordos_convertidos_arquivado::text, d.total_acordos_convertidos_arquivado = a.total_acordos_convertidos_arquivado + 400),
    (8, 'receitas_obra.saldo_pendente NÃO MUDA', a.saldo_pendente::text, d.saldo_pendente::text, d.saldo_pendente = a.saldo_pendente),
    (9, 'obras_financeiro.total_recebido_pagamentos: os 400 saem', (fa.total_recebido_pagamentos - 400)::text, fd.total_recebido_pagamentos::text, fd.total_recebido_pagamentos = fa.total_recebido_pagamentos - 400),
    (10, 'obras_financeiro.total_faturado: a NF entra', (fa.total_faturado + 1600)::text, fd.total_faturado::text, fd.total_faturado = fa.total_faturado + 1600);

  begin
    insert into pagamentos (empresa_id, obra_id, origem, parcela_acordo_id, valor) values (v_emp, v_obra, 'acordo', v_p2, 100);
    v_erro := 'aceitou';
  exception when others then v_erro := sqlerrm;
  end;
  insert into prova values (11, 'baixa em parcela de acordo convertido: recusada', 'pagamento_acordo_fechado', v_erro, v_erro like '%pagamento_acordo_fechado%');

  begin
    perform converter_acordo_em_nf(v_acordo, 'PROVA-11.4-NF2', 'sinal', 1600);
    v_erro := 'converteu de novo';
  exception when others then v_erro := sqlerrm;
  end;
  insert into prova values (12, 'converter de novo: recusado', 'acordo_nao_aberto', v_erro, v_erro like '%acordo_nao_aberto%');

  update acordo_parcelas set valor_previsto = 900 where id = v_p2;
  insert into prova select 13, 'mexer numa parcela não tira o acordo de convertido (trigger do acordo)', 'convertido_nf', status, status = 'convertido_nf'
    from acordos_pagamento where id = v_acordo;
end $$;

select passo, o_que, esperado, obtido, ok from prova order by passo;

rollback;
