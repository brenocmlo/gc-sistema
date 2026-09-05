-- ============================================================
-- CRIAR (OU ATUALIZAR) UM USUÁRIO ADMIN
-- ============================================================
-- Cole no SQL Editor do Supabase (Dashboard → SQL Editor → New query)
-- e rode. Edite só o bloco "PARÂMETROS" abaixo.
--
-- Por que não dá pra fazer pelo Table Editor: um usuário do Supabase
-- Auth não é uma linha só. São três, e elas precisam ser criadas juntas:
--   1. auth.users      — credencial (senha com hash bcrypt)
--   2. auth.identities — o vínculo do provider 'email' com esse usuário
--   3. public.profiles — empresa e perfil, que é o que este app lê
--
-- O script é idempotente: rodar de novo com o mesmo e-mail atualiza a
-- senha e o perfil em vez de duplicar.
--
-- Alternativa recomendada quando houver service role key à mão:
-- Dashboard → Authentication → Users → Add user (cria 1 e 2 corretamente),
-- e aí só a parte 3 deste script é necessária.
-- ============================================================

do $$
declare
  -- ---------- PARÂMETROS ----------
  v_email   text := 'breno@obraminds.com';
  v_senha   text := 'breno1206';
  v_nome    text := 'Breno Camelo';
  v_perfil  text := 'admin';   -- admin | comercial | producao | medicao | financeiro | visualizador
  v_empresa text := null;      -- nome da empresa; null = usa a que já tem profiles
  -- --------------------------------

  v_uid uuid;
  v_empresa_id uuid;
  v_novo boolean := false;
begin
  -- Empresa de destino. Sem nome informado, cai na empresa que já tem
  -- usuários — num banco multi-empresa, pôr o admin na empresa errada
  -- faz ele logar e não enxergar dado nenhum, porque a RLS filtra por
  -- empresa_id.
  if v_empresa is null then
    select e.id into v_empresa_id
      from empresas e
      left join profiles p on p.empresa_id = e.id
     group by e.id
     order by count(p.id) desc, e.created_at
     limit 1;
  else
    select id into v_empresa_id from empresas where nome = v_empresa;
  end if;

  if v_empresa_id is null then
    raise exception 'Nenhuma empresa encontrada (procurado: %). Crie a empresa antes.', coalesce(v_empresa, '<a que tiver profiles>');
  end if;

  select id into v_uid from auth.users where email = v_email;

  if v_uid is null then
    v_uid := gen_random_uuid();
    v_novo := true;

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      -- O GoTrue lê estas colunas como texto e quebra o login com
      -- "Database error querying schema" se vierem NULL. Usuário criado
      -- pela UI já nasce com string vazia; criado por SQL, não.
      confirmation_token, recovery_token, email_change,
      email_change_token_new, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      v_email, extensions.crypt(v_senha, extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('nome', v_nome),
      '', '', '', '', '', '', '', ''
    );
  else
    -- Já existe: só atualiza a senha e garante o e-mail confirmado.
    update auth.users
       set encrypted_password = extensions.crypt(v_senha, extensions.gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                                || jsonb_build_object('nome', v_nome),
           updated_at = now(),
           confirmation_token         = coalesce(confirmation_token, ''),
           recovery_token             = coalesce(recovery_token, ''),
           email_change               = coalesce(email_change, ''),
           email_change_token_new     = coalesce(email_change_token_new, ''),
           email_change_token_current = coalesce(email_change_token_current, ''),
           phone_change               = coalesce(phone_change, ''),
           phone_change_token         = coalesce(phone_change_token, ''),
           reauthentication_token     = coalesce(reauthentication_token, '')
     where id = v_uid;
  end if;

  -- Identidade do provider 'email'. Sem ela o login por senha não resolve.
  -- Atenção: auth.identities.email é coluna GERADA a partir de
  -- identity_data — não tente atribuir valor a ela.
  insert into auth.identities (
    id, user_id, provider_id, provider, identity_data,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_uid, v_uid::text, 'email',
    jsonb_build_object(
      'sub', v_uid::text, 'email', v_email,
      'email_verified', true, 'phone_verified', false
    ),
    now(), now(), now()
  )
  on conflict (provider_id, provider) do update
    set identity_data = excluded.identity_data,
        updated_at    = now();

  -- Perfil da aplicação: é daqui que saem empresa_id e permissão.
  insert into profiles (id, empresa_id, nome, email, perfil, ativo)
  values (v_uid, v_empresa_id, v_nome, v_email, v_perfil, true)
  on conflict (id) do update
    set empresa_id = excluded.empresa_id,
        nome       = excluded.nome,
        email      = excluded.email,
        perfil     = excluded.perfil,
        ativo      = true,
        updated_at = now();

  raise notice '% usuário % (%) como % na empresa %',
    case when v_novo then 'Criado' else 'Atualizado' end,
    v_email, v_uid, v_perfil, v_empresa_id;
end $$;

-- ============================================================
-- Verificação — rode junto, deve voltar 1 linha com tudo preenchido
-- ============================================================
select
  u.email,
  u.email_confirmed_at is not null as email_confirmado,
  (select count(*) from auth.identities i where i.user_id = u.id) as identidades,
  p.perfil,
  p.ativo,
  e.nome as empresa
from auth.users u
join profiles p on p.id = u.id
join empresas e on e.id = p.empresa_id
where u.email = 'breno@obraminds.com';
