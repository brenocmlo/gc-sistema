-- ============================================================
-- 026_execucao_varias_por_item.sql
-- ============================================================
-- Bloco 7.4 — "múltiplas execuções por item". A migration 004
-- (20260511151924) tirou o unique(item_id) e criou `sequencial`, mas os dois
-- triggers de quantidade continuaram escritos para UMA execução por item:
--
-- 1. `execucao_set_quantidade_total` (BEFORE INSERT) sobrescrevia
--    `quantidade_total` com a quantidade inteira do item, qualquer que fosse o
--    valor enviado. A segunda execução de um item (ex.: "Torre B") nascia com
--    o total do item, e não com a parte dela.
--    AGORA: respeita o valor enviado; só puxa do item quando ele vem nulo ou
--    zero (que é o que a ação em lote do 7.2 e o seed mandam).
--
-- 2. `itens_sincroniza_execucao_qtd` (quando `itens.quantidade` muda)
--    gravava a quantidade do item em TODAS as execuções dele.
--    AGORA: sincroniza só quando o item tem exatamente uma execução — o caso
--    em que "a execução é o item inteiro" continua valendo. Com várias, a
--    mudança não é repartida sozinha (não há como saber qual parte muda); a
--    tela de execução mostra a soma das execuções contra a quantidade do item.
--
-- Soma das execuções <= quantidade do item continua regra de APLICAÇÃO (o
-- enunciado do 7.4 diz "o banco não força"): as actions de execução conferem.
--
-- Não mexe em dado: as execuções existentes de gc-dev têm uma por item, e com
-- uma por item as duas funções fazem o mesmo que antes.
-- ============================================================

begin;

create or replace function execucao_set_quantidade_total()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.quantidade_total is null or new.quantidade_total = 0 then
    select quantidade into new.quantidade_total
    from itens where id = new.item_id;
  end if;

  if new.quantidade_total is null then
    new.quantidade_total := 0;
  end if;

  return new;
end;
$$;

create or replace function itens_sincroniza_execucao_qtd()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (new.quantidade is distinct from old.quantidade)
     and (select count(*) from execucao where item_id = new.id) = 1 then
    update execucao
    set quantidade_total = coalesce(new.quantidade, 0)
    where item_id = new.id;
  end if;
  return new;
end;
$$;

commit;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Reaplicar as duas funções de 20260424121550_initial.sql (seção de
-- triggers de execução): a de INSERT sem o `if`, e a de sincronização sem a
-- contagem.
