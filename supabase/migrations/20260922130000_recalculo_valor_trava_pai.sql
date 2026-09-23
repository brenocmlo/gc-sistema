-- ============================================================
-- 016_recalculo_valor_trava_pai.sql
-- ============================================================
-- Corrige uma corrida no trigger do bloco 5.6
-- (20260922120000_recalculo_valor_por_itens.sql).
--
-- O PROBLEMA, medido em gc-dev em 2026-09-22: 4 inserções de item
-- simultâneas na mesma proposta, 20 rodadas → 8 rodadas terminaram com
-- `propostas.valor_total` diferente da soma dos itens.
--
-- Por quê: o trigger é por linha e roda dentro da transação de cada insert.
-- Em READ COMMITTED, a transação B soma os itens sem enxergar o item que a
-- transação A acabou de inserir e ainda não confirmou. B então espera o lock
-- de linha de A no `update propostas`, e quando A confirma, B grava a SUA soma
-- — velha. O último a gravar vence, com o número errado. Acontece de verdade
-- na importação em lote de duas abas, na automação gravando itens em paralelo,
-- e em duas pessoas lançando itens ao mesmo tempo.
--
-- A CORREÇÃO: travar a linha do pai (`select ... for update`) ANTES de somar.
-- B passa a esperar A já na trava; quando A confirma, a soma de B é um
-- comando novo, com snapshot novo, e enxerga o item de A. É a mesma função,
-- com duas linhas a mais por pai.
--
-- `for update` sob `security invoker` exige permissão de UPDATE no pai. Os
-- perfis que escrevem item (admin, comercial) são os que as policies
-- "Propostas: comercial atualiza" e "Contratos: comercial atualiza" deixam
-- atualizar — o mesmo raciocínio da migration anterior.
--
-- Deadlock: um item só tem UM pai de cada tipo, e o trigger trava as
-- propostas antes dos contratos, sempre na mesma ordem. Uma escrita que mova
-- item entre duas propostas trava as duas em ordem de id (o `array_agg`
-- ordena), então duas transações nunca pegam os pais em ordem invertida.
--
-- Reversível: reaplicar a função da migration 20260922120000 desfaz.
-- ============================================================

begin;

create or replace function recalcular_valor_do_pai_do_item()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_propostas uuid[] := '{}';
  v_contratos uuid[] := '{}';
  v_id uuid;
  v_qtd bigint;
  v_soma numeric;
  v_desconto numeric;
begin
  -- Um UPDATE pode mover o item entre pais (troca de proposta_id, ou o
  -- `on delete set null` da FK): o pai antigo E o novo são recalculados.
  if tg_op in ('UPDATE', 'DELETE') then
    if old.proposta_id is not null then v_propostas := v_propostas || old.proposta_id; end if;
    if old.contrato_id is not null then v_contratos := v_contratos || old.contrato_id; end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if new.proposta_id is not null then v_propostas := v_propostas || new.proposta_id; end if;
    if new.contrato_id is not null then v_contratos := v_contratos || new.contrato_id; end if;
  end if;

  -- coalesce é obrigatório: array_agg de conjunto vazio devolve NULL, e
  -- FOREACH sobre NULL estoura (22004). `order by` fixa a ordem de trava.
  foreach v_id in array coalesce(
    (select array_agg(distinct x order by x) from unnest(v_propostas) x), '{}'::uuid[]
  ) loop
    -- A trava. Tem de vir ANTES da soma: é ela que faz a soma enxergar os
    -- itens de quem estava na frente. Também lê o desconto, que antes era
    -- uma consulta separada.
    select p.desconto into v_desconto from propostas p where p.id = v_id for update;
    -- Proposta sendo apagada (FK set null) já não é visível: nada a fazer.
    continue when not found;

    select count(*), coalesce(sum(i.valor_total), 0)
      into v_qtd, v_soma
      from itens i where i.proposta_id = v_id;

    -- Escolha 2: sem itens, o valor volta a ser digitado e fica como está.
    continue when v_qtd = 0;

    -- Escolha 3: soma abaixo do desconto não cabe no CHECK
    -- `propostas_desconto_valido`; fica o valor digitado, e a tela avisa.
    continue when v_soma < coalesce(v_desconto, 0);

    update propostas p
       set valor_total = v_soma
     where p.id = v_id
       and p.valor_total is distinct from v_soma;
  end loop;

  foreach v_id in array coalesce(
    (select array_agg(distinct x order by x) from unnest(v_contratos) x), '{}'::uuid[]
  ) loop
    perform 1 from contratos c where c.id = v_id for update;
    continue when not found;

    select count(*), coalesce(sum(i.valor_total), 0)
      into v_qtd, v_soma
      from itens i where i.contrato_id = v_id;
    continue when v_qtd = 0;

    -- Contrato não tem desconto: não há a escolha 3 aqui.
    update contratos c
       set valor_total = v_soma
     where c.id = v_id
       and c.valor_total is distinct from v_soma;
  end loop;

  return null;
end $$;

comment on function recalcular_valor_do_pai_do_item() is
  'Bloco 5.6: mantém propostas.valor_total e contratos.valor_total iguais à soma '
  'dos itens quando há itens. Sem itens, o valor é digitado e não é tocado. '
  'Trava o pai antes de somar (migration 20260922130000), senão escritas '
  'simultâneas gravam soma velha.';

commit;
