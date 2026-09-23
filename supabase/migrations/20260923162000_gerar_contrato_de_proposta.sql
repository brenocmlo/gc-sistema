-- ============================================================
-- 023_gerar_contrato_de_proposta.sql
-- ============================================================
-- Bloco 6.2 — "Copia dados e itens da proposta para o contrato numa
-- transação". Pelo PostgREST seriam duas chamadas (insert do contrato, insert
-- dos itens), e uma falha na segunda deixaria um contrato sem itens. Uma
-- função plpgsql roda inteira numa transação: ou grava tudo, ou nada.
--
-- Regras, todas conferidas aqui e não só na Server Action (o PostgREST expõe
-- a função direto):
--   * a proposta tem de estar `aprovada`;
--   * se já existe contrato NÃO rescindido desta proposta, recusa com
--     `contrato_ja_gerado_da_proposta` — a menos que `p_confirmar_duplicado`
--     venha true (a "confirmação explícita" do enunciado). Contrato
--     rescindido não conta: gerar outro depois de uma rescisão é o caso
--     normal, não um engano;
--   * a proposta é travada (`for update`) antes dessa conferência: dois
--     cliques simultâneos em "Gerar" não passam os dois pela checagem.
--
-- ITENS: são COPIADOS, não movidos. O XOR `item_vinculo_xor` proíbe um item
-- ligado aos dois, e a proposta aprovada é registro do que foi vendido — ela
-- continua com os itens dela. A cópia leva todos os campos, menos:
--   * `foto_url`: é o path de UM arquivo no Storage. Duas linhas apontando
--     para ele e excluir uma apagaria a foto da outra (mesmo motivo do
--     duplicar do 5.7). Fica como pendência do bloco;
--   * `created_by`: quem gerou o contrato, não quem lançou o item.
--
-- VALOR: com itens copiados, o trigger do 5.6 faz `valor_total` = soma dos
-- itens. Se a soma ficar abaixo do desconto, o trigger não sincroniza e o
-- contrato ficaria com um valor que não bate com os itens — então a função
-- confere no fim e recusa com `contrato_soma_abaixo_do_desconto`.
--
-- `security invoker`: as policies de `contratos` e `itens` valem — só admin
-- e comercial inserem.
-- ============================================================

begin;

create or replace function gerar_contrato_de_proposta(
  p_proposta uuid,
  p_contrato jsonb,
  p_copiar_itens boolean default true,
  p_confirmar_duplicado boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_prop propostas%rowtype;
  v_id uuid;
  v_qtd_itens bigint;
  v_soma numeric;
  v_valor numeric;
begin
  select * into v_prop from propostas where id = p_proposta for update;
  if not found then
    raise exception using message = 'contrato_proposta_nao_encontrada';
  end if;
  if v_prop.status <> 'aprovada' then
    raise exception using message = 'contrato_proposta_nao_aprovada';
  end if;

  if not coalesce(p_confirmar_duplicado, false) and exists (
    select 1 from contratos c
     where c.proposta_origem_id = p_proposta and c.status <> 'rescindido'
  ) then
    raise exception using message = 'contrato_ja_gerado_da_proposta';
  end if;

  if nullif(trim(p_contrato->>'numero'), '') is null then
    raise exception using message = 'contrato_numero_obrigatorio';
  end if;

  select count(*), coalesce(sum(i.valor_total), 0)
    into v_qtd_itens, v_soma
    from itens i where i.proposta_id = p_proposta;

  -- Com itens copiados, o valor É a soma: grava já com ela, para o CHECK
  -- `desconto <= valor_total` valer desde o insert.
  v_valor := case
    when coalesce(p_copiar_itens, true) and v_qtd_itens > 0 then v_soma
    else coalesce((p_contrato->>'valor_total')::numeric, v_prop.valor_total)
  end;

  insert into contratos (
    empresa_id, obra_id, proposta_origem_id, numero, descricao,
    data_assinatura, prazo_execucao, valor_total, desconto,
    pct_sinal, pct_fd, pct_entrega_material, pct_medicao_instalacao,
    condicoes_pagamento, observacao, status, historico, created_by
  ) values (
    v_prop.empresa_id, v_prop.obra_id, p_proposta,
    trim(p_contrato->>'numero'),
    nullif(p_contrato->>'descricao', ''),
    nullif(p_contrato->>'data_assinatura', '')::date,
    nullif(p_contrato->>'prazo_execucao', ''),
    v_valor,
    coalesce((p_contrato->>'desconto')::numeric, v_prop.desconto, 0),
    coalesce((p_contrato->>'pct_sinal')::numeric, 0),
    coalesce((p_contrato->>'pct_fd')::numeric, 0),
    coalesce((p_contrato->>'pct_entrega_material')::numeric, 0),
    coalesce((p_contrato->>'pct_medicao_instalacao')::numeric, 0),
    nullif(p_contrato->>'condicoes_pagamento', ''),
    nullif(p_contrato->>'observacao', ''),
    'ativo', '[]'::jsonb, auth.uid()
  )
  returning id into v_id;

  if coalesce(p_copiar_itens, true) and v_qtd_itens > 0 then
    insert into itens (
      empresa_id, obra_id, proposta_id, contrato_id,
      numero, tipo, descricao, linha, acabamento, largura, altura,
      quantidade, unidade, localizacao, vidros, valor_unit, observacao,
      created_by
    )
    select
      i.empresa_id, i.obra_id, null, v_id,
      i.numero, i.tipo, i.descricao, i.linha, i.acabamento, i.largura, i.altura,
      i.quantidade, i.unidade, i.localizacao, i.vidros, i.valor_unit, i.observacao,
      auth.uid()
    from itens i
    where i.proposta_id = p_proposta
    order by i.numero nulls last, i.created_at;

    -- O trigger já deixou valor_total = soma; confere, porque soma abaixo do
    -- desconto ele pula em silêncio.
    if (select c.valor_total from contratos c where c.id = v_id) is distinct from v_soma then
      raise exception using message = 'contrato_soma_abaixo_do_desconto';
    end if;
  end if;

  return v_id;
end $$;

comment on function gerar_contrato_de_proposta(uuid, jsonb, boolean, boolean) is
  'Bloco 6.2: cria um contrato ativo a partir de uma proposta aprovada e copia os '
  'itens dela, numa transação. Recusa segundo contrato vigente da mesma proposta '
  'sem p_confirmar_duplicado.';

revoke execute on function gerar_contrato_de_proposta(uuid, jsonb, boolean, boolean) from public, anon;
grant execute on function gerar_contrato_de_proposta(uuid, jsonb, boolean, boolean) to authenticated;

commit;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- drop function if exists gerar_contrato_de_proposta(uuid, jsonb, boolean, boolean);
