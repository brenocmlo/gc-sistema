-- ============================================================
-- 031_recalculo_valor_sem_deadlock.sql
-- ============================================================
-- Fechamento da sprint 8. A camada escrita pegou, com o detalhe acrescentado
-- no fechamento da sprint 7, o motivo da falha intermitente do passo "6
-- criações simultâneas": 2 dos 6 inserts voltavam com `deadlock detected`.
--
-- Por quê: ao inserir o item, a FK itens → propostas trava a proposta em
-- FOR KEY SHARE. Depois o trigger desta função pedia FOR UPDATE na mesma
-- linha (migration 20260922130000). Duas transações seguram cada uma o seu
-- KEY SHARE e esperam, cada uma, a outra soltar para conseguir o FOR UPDATE:
-- deadlock. Na tela: duas pessoas lançando item na mesma proposta ao mesmo
-- tempo, e uma delas leva o erro.
--
-- A correção: FOR NO KEY UPDATE, que não conflita com o KEY SHARE da FK e
-- conflita com ele mesmo — continua enfileirando quem soma, e a soma continua
-- enxergando os itens de quem estava na frente (a correção de 22/09). É o
-- mesmo nível de trava que o `update ... set valor_total` já pega, porque
-- valor_total não é chave. Só muda essa palavra, nas duas travas.
--
-- Reversível: reaplicar a função da migration 20260922130000.
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
    select p.desconto into v_desconto from propostas p where p.id = v_id for no key update;
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
    perform 1 from contratos c where c.id = v_id for no key update;
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

commit;
