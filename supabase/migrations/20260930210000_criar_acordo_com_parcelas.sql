-- ============================================================
-- 036_criar_acordo_com_parcelas.sql
-- ============================================================
-- Bloco 11.2. O acordo de pagamento nasce com as parcelas, numa operação só:
-- "ninguém quer cadastrar 6 parcelas manualmente", e um acordo gravado sem as
-- parcelas (porque a segunda chamada falhou) ficaria com valor total zero na
-- listagem. O supabase-js não tem transação; a função faz o acordo e as
-- parcelas dentro da mesma — se uma parcela falhar (CHECK de valor, data
-- inválida), nada fica.
--
-- `security invoker`, como trocar_numero_itens e ajustar_valor_itens: o RLS de
-- acordos_pagamento e acordo_parcelas vale ("financeiro gerencia": admin e
-- financeiro), e a empresa é a de quem chama (current_empresa_id()). As FKs
-- compostas garantem contrato, proposta e parcelas da mesma obra, e o CHECK
-- acordo_vinculo_xor, contrato OU proposta.
--
-- As parcelas chegam como jsonb, na ordem: [{data_vencimento, valor_previsto,
-- observacao?}, ...]; o número de cada uma é a posição (1, 2, 3...).
--
-- Não mexe em dado. Reversível: o rollback está no fim.
-- ============================================================

begin;

-- Os opcionais com default null: o gen tipa como opcionais, e a chamada não
-- precisa forçar null num campo string.
drop function if exists criar_acordo_com_parcelas(uuid, text, text, text, date, uuid, uuid, text, jsonb);

create or replace function criar_acordo_com_parcelas(
  p_obra_id uuid,
  p_descricao text,
  p_parcelas jsonb,
  p_motivo text default null,
  p_periodo_ref text default null,
  p_data_abertura date default null,
  p_contrato_id uuid default null,
  p_proposta_id uuid default null,
  p_observacao text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_empresa uuid := current_empresa_id();
  v_acordo uuid;
  v_qtd integer;
begin
  if v_empresa is null then
    raise exception using message = 'acordo_sem_empresa';
  end if;
  if p_parcelas is null or jsonb_typeof(p_parcelas) <> 'array' then
    raise exception using message = 'acordo_sem_parcelas';
  end if;
  v_qtd := jsonb_array_length(p_parcelas);
  if v_qtd = 0 then
    raise exception using message = 'acordo_sem_parcelas';
  end if;
  if v_qtd > 120 then
    raise exception using message = 'acordo_parcelas_demais';
  end if;

  insert into acordos_pagamento (empresa_id, obra_id, contrato_id, proposta_id, descricao, motivo,
                                 periodo_ref, data_abertura, observacao, created_by)
  values (v_empresa, p_obra_id, p_contrato_id, p_proposta_id, p_descricao, p_motivo,
          p_periodo_ref, coalesce(p_data_abertura, current_date), p_observacao, auth.uid())
  returning id into v_acordo;

  insert into acordo_parcelas (empresa_id, acordo_id, obra_id, numero_parcela, data_vencimento,
                               valor_previsto, observacao)
  select v_empresa, v_acordo, p_obra_id, t.n::integer, (t.e->>'data_vencimento')::date,
         (t.e->>'valor_previsto')::numeric, nullif(btrim(t.e->>'observacao'), '')
    from jsonb_array_elements(p_parcelas) with ordinality as t(e, n);

  return v_acordo;
end;
$$;

revoke execute on function criar_acordo_com_parcelas(uuid, text, jsonb, text, text, date, uuid, uuid, text) from public, anon;
grant execute on function criar_acordo_com_parcelas(uuid, text, jsonb, text, text, date, uuid, uuid, text) to authenticated;

commit;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- drop function if exists criar_acordo_com_parcelas(uuid, text, jsonb, text, text, date, uuid, uuid, text);
