-- ============================================================
-- 018_itens_reordenar_ajustar.sql
-- ============================================================
-- Bloco 5.7 — "duplicar, reordenar e ações em lote". Duas operações do bloco
-- não cabem num `update` do PostgREST, e por isso viram função no banco:
--
-- 1. TROCAR O NÚMERO DE DOIS ITENS (os botões sobe/desce).
--    `idx_itens_numero_proposta` é um índice único NÃO adiável, conferido linha
--    a linha. Medido em gc-dev em 2026-09-23: `update itens set numero = case
--    ... end where id in (a, b)` estoura `duplicate key value violates unique
--    constraint`. A troca precisa de um passo intermediário (numero nulo, que
--    o índice parcial aceita), e os três passos têm de estar na MESMA transação
--    — três chamadas separadas deixariam um item sem número se a segunda
--    falhasse.
--
-- 2. AJUSTE PERCENTUAL EM LOTE ("+5% nos selecionados").
--    É `valor_unit = round(valor_unit * fator, 2)`: uma expressão sobre a
--    coluna, que o PostgREST não faz. Ajustar item a item pela aplicação seria
--    N chamadas, sem atomicidade, e com N disparos do trigger do 5.6.
--
-- As duas são `security invoker`: o RLS de `itens` vale, então só admin e
-- comercial conseguem escrever. E as duas conferem, POR CONTA PRÓPRIA, que a
-- proposta está em rascunho — a regra existe nas Server Actions, mas uma
-- função exposta pelo PostgREST pode ser chamada direto, sem passar por elas.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- trocar_numero_itens
-- ------------------------------------------------------------
create or replace function trocar_numero_itens(p_item_a uuid, p_item_b uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_prop_a uuid; v_prop_b uuid;
  v_num_a integer; v_num_b integer;
  v_status text;
begin
  if p_item_a = p_item_b then
    raise exception using message = 'itens_troca_mesmo_item';
  end if;

  -- Trava as duas linhas em ordem de id: duas trocas simultâneas envolvendo o
  -- mesmo par nunca pegam as travas em ordem invertida (deadlock).
  perform 1 from itens where id in (p_item_a, p_item_b) order by id for update;

  select proposta_id, numero into v_prop_a, v_num_a from itens where id = p_item_a;
  select proposta_id, numero into v_prop_b, v_num_b from itens where id = p_item_b;

  -- Não encontrado inclui "o RLS não deixou ver": para quem chama, é igual.
  if v_prop_a is null or v_prop_b is null then
    raise exception using message = 'itens_troca_nao_encontrado';
  end if;
  if v_prop_a <> v_prop_b then
    raise exception using message = 'itens_troca_propostas_diferentes';
  end if;
  if v_num_a is null or v_num_b is null then
    -- Item sem número (numeração do documento não era inteira) fica no fim,
    -- fora da ordenação: não há posição para trocar.
    raise exception using message = 'itens_troca_sem_numero';
  end if;

  select status into v_status from propostas where id = v_prop_a;
  if v_status is distinct from 'rascunho' then
    raise exception using message = 'itens_proposta_fora_de_rascunho';
  end if;

  update itens set numero = null    where id = p_item_a;
  update itens set numero = v_num_a where id = p_item_b;
  update itens set numero = v_num_b where id = p_item_a;

  -- Nenhum update acima toca valor_unit/quantidade: o trigger do 5.6
  -- (UPDATE OF valor_unit, quantidade, proposta_id, contrato_id) não dispara.
  if not found then
    raise exception using message = 'itens_troca_nao_gravou';
  end if;
end $$;

comment on function trocar_numero_itens(uuid, uuid) is
  'Bloco 5.7: troca o numero de dois itens da mesma proposta em rascunho, numa '
  'transação, passando por null para não violar idx_itens_numero_proposta.';

-- ------------------------------------------------------------
-- ajustar_valor_itens
-- ------------------------------------------------------------
create or replace function ajustar_valor_itens(
  p_proposta uuid,
  p_itens uuid[],
  p_percentual numeric
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_afetados integer;
begin
  -- Limites: abaixo de -100% o valor ficaria negativo (o CHECK recusaria com
  -- erro cru); acima de +1000% é quase certamente um erro de digitação.
  if p_percentual is null or p_percentual <= -100 or p_percentual > 1000 then
    raise exception using message = 'itens_ajuste_percentual_invalido';
  end if;
  if p_itens is null or cardinality(p_itens) = 0 then
    raise exception using message = 'itens_ajuste_sem_itens';
  end if;

  select status into v_status from propostas where id = p_proposta;
  if v_status is null then
    raise exception using message = 'itens_proposta_nao_encontrada';
  end if;
  if v_status <> 'rascunho' then
    raise exception using message = 'itens_proposta_fora_de_rascunho';
  end if;

  -- round(…, 2) em numeric: arredonda o UNITÁRIO para centavos, meio para
  -- cima. O total (coluna gerada) é unitário × quantidade, então pode ter mais
  -- de dois dígitos de precisão antes do cast da coluna — como qualquer item.
  -- Item sem valor_unit fica como está: não há o que ajustar.
  update itens
     set valor_unit = round(valor_unit * (1 + p_percentual / 100), 2)
   where proposta_id = p_proposta
     and id = any (p_itens)
     and valor_unit is not null;
  get diagnostics v_afetados = row_count;

  return v_afetados;
end $$;

comment on function ajustar_valor_itens(uuid, uuid[], numeric) is
  'Bloco 5.7: aplica um ajuste percentual em valor_unit dos itens escolhidos de '
  'uma proposta em rascunho, numa só instrução. Devolve quantos itens mudaram.';

-- Só quem tem sessão chama; o RLS de itens decide o resto.
revoke execute on function trocar_numero_itens(uuid, uuid) from public, anon;
revoke execute on function ajustar_valor_itens(uuid, uuid[], numeric) from public, anon;
grant execute on function trocar_numero_itens(uuid, uuid) to authenticated;
grant execute on function ajustar_valor_itens(uuid, uuid[], numeric) to authenticated;

commit;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- drop function if exists trocar_numero_itens(uuid, uuid);
-- drop function if exists ajustar_valor_itens(uuid, uuid[], numeric);
