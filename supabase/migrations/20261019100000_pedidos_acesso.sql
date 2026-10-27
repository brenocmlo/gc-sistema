-- ============================================================
-- "Esqueci minha senha" sem e-mail: o pedido vai para o administrador
-- ============================================================
-- O link "Esqueci minha senha" do login não fazia nada (só recarregava a
-- página). O reset por e-mail não serve aqui: o gc-dev usa o SMTP padrão do
-- Supabase, que manda 2 e-mails por hora e só para a equipe da organização
-- (o mesmo motivo do convite por link do 13.1). Decisão do Breno, 19/10:
-- a pessoa pede, o admin vê o pedido e manda o link de acesso, que já existe.
--
-- `pedidos_acesso` guarda cada pedido. Quem grava é a Server Action do login,
-- com a chave de serviço, porque quem pede não tem sessão; não há policy de
-- escrita. O admin lê os da própria empresa.
--
-- Pendente = o pedido mais recente da pessoa é posterior ao último login dela
-- (auth.users.last_sign_in_at): entrou de novo, o pedido some sozinho. Só
-- conta usuário ativo. Quem calcula é `pedidos_de_acesso_pendentes()`, que lê
-- auth.users e por isso é SECURITY DEFINER, restrita ao admin.
-- ============================================================

begin;

create table if not exists pedidos_acesso (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  pedido_em timestamptz not null default now()
);

create index if not exists pedidos_acesso_profile_idx on pedidos_acesso (profile_id, pedido_em desc);

alter table pedidos_acesso enable row level security;

drop policy if exists "Pedidos de acesso: admin lê os da empresa" on pedidos_acesso;
create policy "Pedidos de acesso: admin lê os da empresa" on pedidos_acesso
  for select using (empresa_id = current_empresa_id() and has_perfil(array['admin']));

create or replace function pedidos_de_acesso_pendentes()
returns table (profile_id uuid, pedido_em timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, ult.pedido_em
    from profiles p
    join lateral (
      select max(pa.pedido_em) as pedido_em from pedidos_acesso pa where pa.profile_id = p.id
    ) ult on ult.pedido_em is not null
    left join auth.users u on u.id = p.id
   where p.empresa_id = current_empresa_id()
     and has_perfil(array['admin'])
     and coalesce(p.ativo, true)
     and ult.pedido_em > coalesce(u.last_sign_in_at, '-infinity'::timestamptz)
   order by ult.pedido_em desc;
$$;

revoke all on function pedidos_de_acesso_pendentes() from public, anon;
grant execute on function pedidos_de_acesso_pendentes() to authenticated;

commit;
