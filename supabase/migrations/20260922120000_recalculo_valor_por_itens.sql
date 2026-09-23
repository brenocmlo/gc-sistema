-- ============================================================
-- 015_recalculo_valor_por_itens.sql
-- ============================================================
-- Bloco 5.6 — "O valor_total da proposta precisa refletir a soma dos itens,
-- sem que o usuário digite duas vezes."
--
-- A REGRA, e por que é híbrida:
--
--   * proposta/contrato SEM itens → `valor_total` é digitado, como sempre foi;
--   * proposta/contrato COM itens → `valor_total` = soma de `itens.valor_total`,
--     mantida por este trigger a cada insert, update e delete de item.
--
-- "Sempre a soma" foi descartado com o dado na mão. Em 2026-09-22 gc-dev tinha
-- 20 propostas, TODAS sem item e com valor digitado — entre elas 3 aprovadas
-- (PROP-2026-008/009/010) que alimentam `obras_com_valores`. Uma regra de soma
-- pura, com backfill, zeraria o valor dessas obras. Em gc-prod o risco é o
-- mesmo e maior.
--
-- Três escolhas que valem registro:
--
-- 1. SEM BACKFILL. A migration não reescreve nenhum `valor_total` existente.
--    Divergência que já existia fica visível pelo aviso da tela (bloco 5.6) e
--    se resolve pelo botão "usar a soma dos itens", com a pessoa decidindo. Um
--    backfill mudaria valor comercial em silêncio.
--
-- 2. EXCLUIR O ÚLTIMO ITEM NÃO ZERA O VALOR. Quando a mudança deixa o pai sem
--    itens, o trigger não toca em `valor_total`: a proposta volta a ser de
--    valor digitado, guardando o último valor que tinha. Zerar seria destruir
--    o valor comercial por remover o detalhamento — e, com desconto, o próprio
--    CHECK `propostas_desconto_valido` bloquearia a exclusão.
--
-- 3. ENQUANTO A SOMA NÃO ALCANÇA O DESCONTO, O VALOR DIGITADO SEGUE VALENDO.
--    Se a soma dos itens é menor que o desconto, gravá-la violaria o CHECK
--    `propostas_desconto_valido` (desconto <= valor_total). O trigger então
--    NÃO sincroniza — e também NÃO bloqueia: a tela mostra a divergência e
--    explica por quê, e na primeira mudança em que a soma alcançar o desconto
--    o valor passa a acompanhá-la.
--
--    A primeira versão desta migration levantava exceção nesse caso. A camada
--    de navegador derrubou a ideia: numa proposta com desconto, o PRIMEIRO item
--    lançado (ou a linha em branco do "Adicionar item") sempre soma menos que o
--    desconto, então era impossível começar a lançar itens. Reduzir o desconto
--    sozinho também foi descartado: desconto é termo comercial, não é conta.
--
-- Trigger, e não recálculo na Server Action, porque os itens NÃO são escritos
-- só pelo app: o workflow n8n de contrato (4a) insere `itens` direto por REST
-- com a service key, e a rota de ingestão da automação (Fase 6) vai gravar
-- itens de proposta. A regra no banco vale para todos; na action, só para a
-- tela.
--
-- `obras_com_valores` NÃO muda: ela lê `propostas.valor_total` e
-- `contratos.valor_total`, não os itens. Mantendo a coluna igual à soma, a view
-- continua batendo por consequência — é o que a camada de escrita prova, com
-- uma proposta aprovada de itens somados.
--
-- Reversível; rollback no fim, comentado.
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
  -- FOREACH sobre NULL estoura (22004). Item de proposta tem a lista de
  -- contratos vazia — sem isto, TODO insert de item falhava. Foi pego pela
  -- prova em transação desfeita, antes de qualquer tela usar o trigger.
  foreach v_id in array coalesce(
    (select array_agg(distinct x) from unnest(v_propostas) x), '{}'::uuid[]
  ) loop
    select count(*), coalesce(sum(i.valor_total), 0)
      into v_qtd, v_soma
      from itens i where i.proposta_id = v_id;

    -- Escolha 2: sem itens, o valor volta a ser digitado e fica como está.
    continue when v_qtd = 0;

    select p.desconto into v_desconto from propostas p where p.id = v_id;
    -- Proposta sendo apagada (FK set null) já não é visível: nada a fazer.
    continue when not found;

    -- Escolha 3: soma abaixo do desconto não cabe no CHECK; fica o valor
    -- digitado, e a tela avisa.
    continue when v_soma < coalesce(v_desconto, 0);

    update propostas p
       set valor_total = v_soma
     where p.id = v_id
       and p.valor_total is distinct from v_soma;
  end loop;

  -- Mesmo coalesce, pelo mesmo motivo (lista vazia vira NULL).
  foreach v_id in array coalesce(
    (select array_agg(distinct x) from unnest(v_contratos) x), '{}'::uuid[]
  ) loop
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
  'dos itens quando há itens. Sem itens, o valor é digitado e não é tocado.';

drop trigger if exists trg_itens_recalcula_pai on itens;

-- UPDATE OF só nas colunas que mudam a soma ou o pai. `valor_total` é GENERATED
-- e não pode ser listada, mas muda exatamente quando valor_unit/quantidade
-- mudam. Editar descrição, foto ou observação não recalcula nada.
create trigger trg_itens_recalcula_pai
  after insert or delete or update of valor_unit, quantidade, proposta_id, contrato_id
  on itens
  for each row execute function recalcular_valor_do_pai_do_item();

-- ============================================================
-- Verificação — falha alto, não em silêncio
-- ============================================================
do $$
declare n int;
begin
  select count(*) into n from pg_trigger
   where tgrelid = 'itens'::regclass and tgname = 'trg_itens_recalcula_pai' and not tgisinternal;
  if n <> 1 then
    raise exception 'trg_itens_recalcula_pai não foi criado (encontrados %)', n;
  end if;
  raise notice 'recalculo_valor_por_itens: trigger criado; nenhum valor existente alterado (sem backfill)';
end $$;

commit;

-- ============================================================
-- ROLLBACK (colar no SQL Editor; não roda automaticamente)
-- ============================================================
-- begin;
-- drop trigger if exists trg_itens_recalcula_pai on itens;
-- drop function if exists recalcular_valor_do_pai_do_item();
-- commit;
