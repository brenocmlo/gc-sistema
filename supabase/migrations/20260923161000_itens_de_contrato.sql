-- ============================================================
-- 022_itens_de_contrato.sql
-- ============================================================
-- Bloco 6.4 — "Aba Itens (reusa a ItensTable do Sprint 5)". As duas funções
-- do bloco 5.7 só conheciam proposta: `trocar_numero_itens` lia
-- `proposta_id` e `ajustar_valor_itens` recebia a proposta. No contrato, os
-- botões sobe/desce e o ajuste em lote precisam delas também.
--
-- QUANDO O ITEM DE CONTRATO É EDITÁVEL: contrato `ativo`. É o equivalente do
-- `rascunho` da proposta — o único status em que o escopo ainda muda.
-- `suspenso`, `concluido` e `rescindido` deixam a aba somente leitura. A mesma
-- regra está em `itemPaiEditavel` (src/lib/itens.ts), e as funções a conferem
-- por conta própria pelo mesmo motivo do 5.7: o PostgREST as expõe direto.
--
-- `trocar_numero_itens` mantém a assinatura (a Server Action da proposta
-- continua chamando igual). O ajuste ganha uma função irmã para contrato em
-- vez de um parâmetro de tipo: assinatura nova não quebra quem chama a antiga.
-- ============================================================

begin;

create or replace function trocar_numero_itens(p_item_a uuid, p_item_b uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_prop_a uuid; v_prop_b uuid;
  v_ctr_a uuid; v_ctr_b uuid;
  v_num_a integer; v_num_b integer;
  v_status text;
begin
  if p_item_a = p_item_b then
    raise exception using message = 'itens_troca_mesmo_item';
  end if;

  perform 1 from itens where id in (p_item_a, p_item_b) order by id for update;

  select proposta_id, contrato_id, numero into v_prop_a, v_ctr_a, v_num_a from itens where id = p_item_a;
  if not found then raise exception using message = 'itens_troca_nao_encontrado'; end if;
  select proposta_id, contrato_id, numero into v_prop_b, v_ctr_b, v_num_b from itens where id = p_item_b;
  if not found then raise exception using message = 'itens_troca_nao_encontrado'; end if;

  -- O mesmo pai: mesma proposta, ou mesmo contrato. Item sem pai nenhum
  -- (órfão do `on delete set null`) não se move.
  if coalesce(v_prop_a, v_ctr_a) is null
     or v_prop_a is distinct from v_prop_b
     or v_ctr_a is distinct from v_ctr_b then
    raise exception using message = 'itens_troca_propostas_diferentes';
  end if;
  if v_num_a is null or v_num_b is null then
    raise exception using message = 'itens_troca_sem_numero';
  end if;

  if v_prop_a is not null then
    select status into v_status from propostas where id = v_prop_a;
    if v_status is distinct from 'rascunho' then
      raise exception using message = 'itens_proposta_fora_de_rascunho';
    end if;
  else
    select status into v_status from contratos where id = v_ctr_a;
    if v_status is distinct from 'ativo' then
      raise exception using message = 'itens_contrato_nao_ativo';
    end if;
  end if;

  update itens set numero = null    where id = p_item_a;
  update itens set numero = v_num_a where id = p_item_b;
  update itens set numero = v_num_b where id = p_item_a;
  if not found then
    raise exception using message = 'itens_troca_nao_gravou';
  end if;
end $$;

comment on function trocar_numero_itens(uuid, uuid) is
  'Blocos 5.7/6.4: troca o numero de dois itens do mesmo pai editável (proposta '
  'em rascunho ou contrato ativo), passando por null para não violar o índice único.';

create or replace function ajustar_valor_itens_contrato(
  p_contrato uuid,
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
  if p_percentual is null or p_percentual <= -100 or p_percentual > 1000 then
    raise exception using message = 'itens_ajuste_percentual_invalido';
  end if;
  if p_itens is null or cardinality(p_itens) = 0 then
    raise exception using message = 'itens_ajuste_sem_itens';
  end if;

  select status into v_status from contratos where id = p_contrato;
  if v_status is null then
    raise exception using message = 'itens_contrato_nao_encontrado';
  end if;
  if v_status <> 'ativo' then
    raise exception using message = 'itens_contrato_nao_ativo';
  end if;

  update itens
     set valor_unit = round(valor_unit * (1 + p_percentual / 100), 2)
   where contrato_id = p_contrato
     and id = any (p_itens)
     and valor_unit is not null;
  get diagnostics v_afetados = row_count;

  return v_afetados;
end $$;

comment on function ajustar_valor_itens_contrato(uuid, uuid[], numeric) is
  'Bloco 6.4: mesma regra de ajustar_valor_itens (5.7), para os itens de um contrato ativo.';

revoke execute on function ajustar_valor_itens_contrato(uuid, uuid[], numeric) from public, anon;
grant execute on function ajustar_valor_itens_contrato(uuid, uuid[], numeric) to authenticated;

commit;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- drop function if exists ajustar_valor_itens_contrato(uuid, uuid[], numeric);
-- e reaplicar trocar_numero_itens de 20260923120000.
