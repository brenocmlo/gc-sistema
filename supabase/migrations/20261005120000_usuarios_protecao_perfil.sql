-- ============================================================
-- 13.1 Gestão de usuários: proteção do perfil e do usuário inativo
-- ============================================================
-- Duas falhas de segurança achadas ao desenhar a tela de usuários, as duas
-- provadas em gc-dev em 2026-10-05 numa transação desfeita:
--
-- 1. Escalada de privilégio. A policy "Usuário edita próprio perfil" deixa o
--    usuário atualizar a PRÓPRIA linha conferindo só id e empresa — nenhuma
--    coluna travada. Com a sessão do comercial, `update profiles set perfil =
--    'admin' where id = auth.uid()` passava, e has_perfil(array['admin'])
--    respondia true. Qualquer usuário virava admin pela API do Supabase.
--    Correção: trigger BEFORE UPDATE que só deixa o admin mudar perfil,
--    situação (ativo), e-mail; e ninguém muda a empresa.
--
-- 2. Usuário inativo continuava passando nas policies. current_empresa_id(),
--    current_perfil() e has_perfil(), que TODAS as policies usam, não olhavam
--    profiles.ativo. Correção: as três passam a exigir ativo; o inativo não
--    lê nem grava nada. Para a aplicação conseguir dizer "acesso desativado",
--    ele ainda lê a PRÓPRIA linha (policy nova).
--
-- E uma trava de operação: a empresa não fica sem admin ativo (rebaixar,
-- desativar ou excluir o último admin é recusado).
-- ============================================================

-- 1. As funções das policies exigem o usuário ativo
create or replace function current_empresa_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select empresa_id from profiles where id = auth.uid() and coalesce(ativo, true) limit 1;
$$;

create or replace function current_perfil()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select perfil from profiles where id = auth.uid() and coalesce(ativo, true) limit 1;
$$;

create or replace function has_perfil(perfis text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select perfil from profiles where id = auth.uid() and coalesce(ativo, true)) = any(perfis), false);
$$;

-- 2. Todo usuário lê a própria linha, mesmo inativo (a tela diz "desativado")
drop policy if exists "Usuário vê o próprio perfil" on profiles;
create policy "Usuário vê o próprio perfil" on profiles
  for select using (id = auth.uid());

-- 3. Campos que só o admin muda; empresa que ninguém muda; o último admin ativo
create or replace function profiles_proteger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_resta_admin boolean;
begin
  if tg_op = 'UPDATE' then
    if new.empresa_id is distinct from old.empresa_id then
      raise exception 'O usuário não muda de empresa' using errcode = '42501';
    end if;
    -- auth.uid() nulo é a service role (scripts e a API de administração).
    if auth.uid() is not null and not has_perfil(array['admin'])
       and (new.perfil is distinct from old.perfil
            or new.ativo is distinct from old.ativo
            or new.email is distinct from old.email) then
      raise exception 'Só o admin muda o perfil, a situação ou o e-mail de um usuário' using errcode = '42501';
    end if;
  end if;

  -- O último admin ativo da empresa não sai: nem rebaixado, nem desativado, nem excluído.
  if old.perfil = 'admin' and coalesce(old.ativo, true)
     and (tg_op = 'DELETE' or new.perfil <> 'admin' or not coalesce(new.ativo, true)) then
    select exists (
      select 1 from profiles
       where empresa_id = old.empresa_id and id <> old.id and perfil = 'admin' and coalesce(ativo, true)
    ) into v_resta_admin;
    if not v_resta_admin then
      raise exception 'A empresa precisa de ao menos um admin ativo' using errcode = '42501';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_profiles_proteger on profiles;
create trigger trg_profiles_proteger
  before update or delete on profiles
  for each row execute function profiles_proteger();
