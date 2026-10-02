-- ============================================================
-- 035_pagamento_parcela_cancelada_e_comprovante.sql
-- ============================================================
-- Duas pendências da sprint 10, resolvidas no banco.
--
-- 1. Pagamento em parcela cancelada (10.5, seção 3). A prova da cascata
--    mostrou que o banco aceitava: só a action do 10.2 recusava, e um POST
--    direto, ou a integração, gravaria. Agora é o mesmo trigger da NF
--    cancelada (034): BEFORE INSERT, ou UPDATE que troque a parcela para uma
--    cancelada, recusa com 'pagamento_parcela_cancelada'. Os pagamentos que já
--    existiam antes do cancelamento ficam (histórico); o status da parcela
--    cancelada já não era recalculado (atualizar_status_parcela_by_id sai cedo).
--
-- 2. Comprovante antigo sobrando no bucket (10.4, seção 2). Substituir o
--    comprovante sobe um arquivo novo e apaga o anterior; no bucket `anexos`
--    só o admin ou o dono do arquivo apagavam, então um financeiro que
--    substituísse o comprovante de outro financeiro deixava o antigo sem
--    referência. A policy nova deixa admin e financeiro apagarem, na própria
--    empresa, só o que está em `{empresa}/{obra}/pagamentos/...` — a pasta dos
--    comprovantes, que são do financeiro. Os outros anexos seguem com a regra
--    de antes.
--
-- Não mexe em dado. Reversível: o rollback está no fim.
-- ============================================================

begin;

create or replace function pagamento_recusa_parcela_cancelada()
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
  if exists (select 1 from acordo_parcelas where id = new.parcela_acordo_id and status = 'cancelada') then
    raise exception using message = 'pagamento_parcela_cancelada',
      detail = 'Parcela cancelada não recebe pagamento.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pagamento_recusa_parcela_cancelada on pagamentos;
create trigger trg_pagamento_recusa_parcela_cancelada
  before insert or update of parcela_acordo_id on pagamentos
  for each row execute function pagamento_recusa_parcela_cancelada();

drop policy if exists "Anexos: financeiro exclui comprovante de pagamento" on storage.objects;
create policy "Anexos: financeiro exclui comprovante de pagamento" on storage.objects
  for delete using (
    bucket_id = 'anexos'
    and storage_empresa_id_from_path(name) = current_empresa_id()
    and (storage.foldername(name))[3] = 'pagamentos'
    and has_perfil(array['admin', 'financeiro'])
  );

commit;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- drop policy if exists "Anexos: financeiro exclui comprovante de pagamento" on storage.objects;
-- drop trigger if exists trg_pagamento_recusa_parcela_cancelada on pagamentos;
-- drop function if exists pagamento_recusa_parcela_cancelada();
