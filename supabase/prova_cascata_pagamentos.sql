-- ============================================================
-- PROVA: a cascata de status de NF, parcela e acordo pelos pagamentos (gc-dev)
-- ============================================================
--   npx supabase db query --linked --file supabase/prova_cascata_pagamentos.sql
--
-- Bloco 10.5 ("Regra 4 do CONTEXT: verificada de ponta a ponta, não
-- presumida"). Roda tudo dentro de uma transação e DESFAZ no fim: cria uma
-- NF, um acordo e as parcelas próprios (PROVA-10.5-*), lança, altera, move e
-- apaga pagamentos, e anota em `prova` o status esperado e o obtido depois de
-- cada passo. Nada fica em gc-dev.
--
-- A última consulta devolve uma linha por passo; `ok` tem de ser true em
-- todas. Não depende de seed além de uma obra da empresa do SEED-CT-EXEC.
-- ============================================================

begin;

create temp table prova (passo int, o_que text, esperado text, obtido text, ok boolean) on commit drop;

do $$
declare
  v_emp uuid; v_obra uuid;
  v_nf1 uuid; v_nf2 uuid; v_pg1 uuid; v_pg2 uuid; v_pg3 uuid;
  v_acordo uuid; v_parc uuid; v_parc_canc uuid; v_pa1 uuid; v_pa2 uuid;
  v_erro text;
begin
  select c.empresa_id, c.obra_id into v_emp, v_obra from contratos c where c.numero = 'SEED-CT-EXEC';
  if v_emp is null then raise exception 'SEED-CT-EXEC ausente'; end if;

  -- NF ------------------------------------------------------------------
  insert into notas_fiscais (empresa_id, obra_id, numero, tipo, valor_total, data_emissao)
  values (v_emp, v_obra, 'PROVA-10.5-NF1', 'outro', 1000, current_date) returning id into v_nf1;
  insert into notas_fiscais (empresa_id, obra_id, numero, tipo, valor_total, data_emissao)
  values (v_emp, v_obra, 'PROVA-10.5-NF2', 'outro', 2000, current_date) returning id into v_nf2;

  insert into pagamentos (empresa_id, obra_id, origem, nota_id, valor) values (v_emp, v_obra, 'nf', v_nf1, 400) returning id into v_pg1;
  insert into prova select 1, 'pagamento parcial (400 de 1000)', 'paga_parcialmente', status, status = 'paga_parcialmente' from notas_fiscais where id = v_nf1;

  insert into pagamentos (empresa_id, obra_id, origem, nota_id, valor) values (v_emp, v_obra, 'nf', v_nf1, 600) returning id into v_pg2;
  insert into prova select 2, 'pagamento que completa o valor (400 + 600)', 'paga', status, status = 'paga' from notas_fiscais where id = v_nf1;

  delete from pagamentos where id = v_pg2;
  insert into prova select 3, 'excluir o pagamento que completava', 'paga_parcialmente', status, status = 'paga_parcialmente' from notas_fiscais where id = v_nf1;

  delete from pagamentos where id = v_pg1;
  insert into prova select 4, 'excluir o último pagamento', 'emitida', status, status = 'emitida' from notas_fiscais where id = v_nf1;

  insert into pagamentos (empresa_id, obra_id, origem, nota_id, valor) values (v_emp, v_obra, 'nf', v_nf1, 1200) returning id into v_pg3;
  insert into prova select 5, 'pagamento acima do valor (1200 de 1000)', 'paga', status, status = 'paga' from notas_fiscais where id = v_nf1;

  update pagamentos set valor = 500 where id = v_pg3;
  insert into prova select 6, 'editar o valor do pagamento para 500', 'paga_parcialmente', status, status = 'paga_parcialmente' from notas_fiscais where id = v_nf1;

  update pagamentos set nota_id = v_nf2 where id = v_pg3;
  insert into prova select 7, 'mover o pagamento para outra NF: a de origem', 'emitida', status, status = 'emitida' from notas_fiscais where id = v_nf1;
  insert into prova select 8, 'mover o pagamento para outra NF: a de destino (500 de 2000)', 'paga_parcialmente', status, status = 'paga_parcialmente' from notas_fiscais where id = v_nf2;

  update notas_fiscais set valor_total = 500 where id = v_nf2;
  insert into prova select 9, 'baixar o valor da NF para o que já entrou', 'paga', status, status = 'paga' from notas_fiscais where id = v_nf2;

  update notas_fiscais set valor_total = 800 where id = v_nf2;
  update notas_fiscais set status = 'cancelada', motivo_cancelamento = 'prova do 10.5', data_cancelamento = current_date where id = v_nf2;
  begin
    insert into pagamentos (empresa_id, obra_id, origem, nota_id, valor) values (v_emp, v_obra, 'nf', v_nf2, 300);
    v_erro := 'aceitou';
  exception when others then v_erro := sqlerrm;
  end;
  insert into prova select 10, 'NF cancelada recebe pagamento: recusado e o status fica', 'cancelada / pagamento_nf_cancelada',
    status || ' / ' || v_erro, status = 'cancelada' and v_erro like '%pagamento_nf_cancelada%' from notas_fiscais where id = v_nf2;

  delete from pagamentos where id = v_pg3;
  insert into prova select 11, 'excluir pagamento de NF cancelada: o status não se mexe', 'cancelada', status, status = 'cancelada' from notas_fiscais where id = v_nf2;

  -- Parcela e acordo ------------------------------------------------------
  insert into acordos_pagamento (empresa_id, obra_id, descricao) values (v_emp, v_obra, 'PROVA-10.5-AC') returning id into v_acordo;
  insert into acordo_parcelas (empresa_id, acordo_id, obra_id, numero_parcela, data_vencimento, valor_previsto)
  values (v_emp, v_acordo, v_obra, 1, current_date, 1000) returning id into v_parc;

  insert into pagamentos (empresa_id, obra_id, origem, parcela_acordo_id, valor) values (v_emp, v_obra, 'acordo', v_parc, 300) returning id into v_pa1;
  insert into prova select 12, 'parcela: pagamento parcial (300 de 1000)', 'paga_parcialmente', status, status = 'paga_parcialmente' from acordo_parcelas where id = v_parc;

  insert into pagamentos (empresa_id, obra_id, origem, parcela_acordo_id, valor) values (v_emp, v_obra, 'acordo', v_parc, 700) returning id into v_pa2;
  insert into prova select 13, 'parcela: pagamento que completa', 'paga', status, status = 'paga' from acordo_parcelas where id = v_parc;
  insert into prova select 14, 'acordo com a única parcela paga', 'quitado', status, status = 'quitado' from acordos_pagamento where id = v_acordo;

  delete from pagamentos where id = v_pa2;
  insert into prova select 15, 'parcela: excluir o pagamento que completava', 'paga_parcialmente', status, status = 'paga_parcialmente' from acordo_parcelas where id = v_parc;
  insert into prova select 16, 'acordo volta a aberto', 'aberto', status, status = 'aberto' from acordos_pagamento where id = v_acordo;

  insert into acordo_parcelas (empresa_id, acordo_id, obra_id, numero_parcela, data_vencimento, valor_previsto, status)
  values (v_emp, v_acordo, v_obra, 2, current_date, 500, 'cancelada') returning id into v_parc_canc;
  insert into pagamentos (empresa_id, obra_id, origem, parcela_acordo_id, valor) values (v_emp, v_obra, 'acordo', v_parc_canc, 500);
  insert into prova select 17, 'parcela cancelada recebe pagamento: o BANCO aceita, e o status fica (a action recusa, 10.2)', 'cancelada',
    status, status = 'cancelada' from acordo_parcelas where id = v_parc_canc;

  insert into prova select 18, 'nenhuma NF ou parcela ficou com o status antigo ''parcial''', '0',
    (select count(*) from notas_fiscais where status = 'parcial')::text || '+' || (select count(*) from acordo_parcelas where status = 'parcial')::text,
    not exists (select 1 from notas_fiscais where status = 'parcial') and not exists (select 1 from acordo_parcelas where status = 'parcial');
end $$;

select passo, o_que, esperado, obtido, ok from prova order by passo;

rollback;
