-- ============================================================
-- 037_converter_acordo_em_nf.sql
-- ============================================================
-- Bloco 11.4. Regra 7 do CONTEXT: o acordo pode virar nota fiscal, e então os
-- pagamentos dele ficam "arquivados" nas views (não entram em total_recebido;
-- ficam em receitas_obra.total_acordos_convertidos_arquivado) e as parcelas
-- saem do total a receber. A NF nova entra no lugar: é a "NF de saldo", que
-- representa o que ainda falta receber. As views já tratam o status
-- 'convertido_nf' desde a migration inicial; faltava a operação.
--
-- 1. converter_acordo_em_nf: cria a NF (vínculo, obra e empresa do acordo) e
--    marca o acordo como convertido (nf_convertida_id, data_encerramento) NUMA
--    transação: uma NF sem o acordo convertido contaria o mesmo dinheiro duas
--    vezes nas views. Só acordo aberto, com a linha travada (for update) para
--    duas conversões simultâneas não criarem duas NFs. `security invoker`,
--    como as outras RPCs: o RLS de notas_fiscais e acordos_pagamento vale.
--
-- 2. Baixa em acordo convertido (ou cancelado): BEFORE INSERT, ou UPDATE que
--    troque a parcela, recusa com 'pagamento_acordo_fechado'. A tela já não
--    oferece (o select de pagamento só tem acordo aberto); isto fecha o POST
--    direto e a integração, como o 035 fez para a parcela cancelada.
--
-- Não mexe em dado. Reversível: o rollback está no fim.
-- ============================================================

begin;

create or replace function converter_acordo_em_nf(
  p_acordo_id uuid,
  p_numero text,
  p_tipo text,
  p_valor_total numeric,
  p_data_emissao date default null,
  p_serie text default null,
  p_chave_nfe text default null,
  p_data_vencimento date default null,
  p_observacao text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_acordo acordos_pagamento%rowtype;
  v_nf uuid;
begin
  select * into v_acordo from acordos_pagamento where id = p_acordo_id for update;
  if not found then
    raise exception using message = 'acordo_nao_encontrado';
  end if;
  if v_acordo.status <> 'aberto' then
    raise exception using message = 'acordo_nao_aberto',
      detail = 'Só acordo aberto é convertido em nota fiscal.';
  end if;

  insert into notas_fiscais (empresa_id, obra_id, contrato_id, proposta_id, numero, serie, chave_nfe, tipo,
                             data_emissao, data_vencimento, valor_total, status, observacao, created_by)
  values (v_acordo.empresa_id, v_acordo.obra_id, v_acordo.contrato_id, v_acordo.proposta_id, p_numero, p_serie,
          p_chave_nfe, p_tipo, coalesce(p_data_emissao, current_date), p_data_vencimento, p_valor_total,
          'emitida', p_observacao, auth.uid())
  returning id into v_nf;

  update acordos_pagamento
     set status = 'convertido_nf', nf_convertida_id = v_nf, data_encerramento = current_date
   where id = p_acordo_id;

  return v_nf;
end;
$$;

revoke execute on function converter_acordo_em_nf(uuid, text, text, numeric, date, text, text, date, text) from public, anon;
grant execute on function converter_acordo_em_nf(uuid, text, text, numeric, date, text, text, date, text) to authenticated;

create or replace function pagamento_recusa_acordo_fechado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.parcela_acordo_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.parcela_acordo_id is not distinct from old.parcela_acordo_id then
    return new;
  end if;
  if exists (
    select 1 from acordo_parcelas ap join acordos_pagamento a on a.id = ap.acordo_id
     where ap.id = new.parcela_acordo_id and a.status in ('convertido_nf', 'cancelado')
  ) then
    raise exception using message = 'pagamento_acordo_fechado',
      detail = 'Acordo convertido em nota fiscal ou cancelado não recebe baixa.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pagamento_recusa_acordo_fechado on pagamentos;
create trigger trg_pagamento_recusa_acordo_fechado
  before insert or update of parcela_acordo_id on pagamentos
  for each row execute function pagamento_recusa_acordo_fechado();

commit;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- drop trigger if exists trg_pagamento_recusa_acordo_fechado on pagamentos;
-- drop function if exists pagamento_recusa_acordo_fechado();
-- drop function if exists converter_acordo_em_nf(uuid, text, text, numeric, date, text, text, date, text);
