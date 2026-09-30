-- ============================================================
-- 034_nf_cancelada_terminal.sql
-- ============================================================
-- Bloco 9.4. Regra 6 do CONTEXT: NF cancelada é status terminal. Até aqui
-- isso era só "os triggers de status não sobrescrevem" (atualizar_status_nf_by_id
-- sai cedo na cancelada). Nada impedia um UPDATE qualquer de reabrir a NF, nem
-- um pagamento novo de entrar nela — a tela de pagamentos chega no sprint 10,
-- e a regra tem de valer antes dela.
--
-- 1. NF cancelada não muda mais: BEFORE UPDATE recusa com
--    'nf_cancelada_imutavel'. O cancelamento em si (de outro status para
--    cancelada) passa, porque o OLD ainda não é cancelado. Excluir continua
--    sendo da policy (só admin) e da aplicação, que recusa excluir cancelada.
-- 2. Pagamento novo em NF cancelada: BEFORE INSERT, ou UPDATE que troque o
--    nota_id para uma cancelada, recusa com 'pagamento_nf_cancelada'. Os
--    pagamentos que já existiam antes do cancelamento ficam (histórico).
--
-- Não mexe em dado. Reversível: o rollback está no fim.
-- ============================================================

begin;

create or replace function nf_cancelada_imutavel()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status = 'cancelada' then
    raise exception using message = 'nf_cancelada_imutavel',
      detail = 'Nota fiscal cancelada é terminal e não pode ser alterada.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_nf_cancelada_imutavel on notas_fiscais;
create trigger trg_nf_cancelada_imutavel
  before update on notas_fiscais
  for each row execute function nf_cancelada_imutavel();

-- security definer: o status da NF tem de ser lido mesmo por quem só vê os
-- pagamentos, e a checagem não pode depender da RLS de quem insere.
create or replace function pagamento_recusa_nf_cancelada()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.nota_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.nota_id is not distinct from old.nota_id then
    return new;
  end if;
  if exists (select 1 from notas_fiscais where id = new.nota_id and status = 'cancelada') then
    raise exception using message = 'pagamento_nf_cancelada',
      detail = 'Nota fiscal cancelada não recebe pagamento.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pagamento_recusa_nf_cancelada on pagamentos;
create trigger trg_pagamento_recusa_nf_cancelada
  before insert or update of nota_id on pagamentos
  for each row execute function pagamento_recusa_nf_cancelada();

commit;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- drop trigger if exists trg_pagamento_recusa_nf_cancelada on pagamentos;
-- drop function if exists pagamento_recusa_nf_cancelada();
-- drop trigger if exists trg_nf_cancelada_imutavel on notas_fiscais;
-- drop function if exists nf_cancelada_imutavel();
