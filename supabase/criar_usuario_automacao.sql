-- ============================================================
-- PROFILE DE SERVIÇO DA AUTOMAÇÃO
-- ============================================================
--   bash scripts/aplicar-seed.sh supabase/criar_usuario_automacao.sql
--   bash scripts/aplicar-seed.sh --verificar supabase/criar_usuario_automacao.sql
--
-- Fase 1 do plano docs/tecnicos/migracao-telegram-integracao-automacao.md,
-- decisão 12 da Seção 4.
--
-- POR QUE EXISTE
-- A rota de ingestão da Fase 6 grava propostas vindas do Telegram.
-- `propostas.created_by` é FK para `profiles`, e `propostas.historico[].por`
-- guarda o UUID de um profile — conferido em
-- src/app/(app)/propostas/[id]/actions.ts:168 (`por: auth.userId`) e
-- src/components/HistoricoTab.tsx:49, que resolve esse uuid para o nome.
-- Sem um profile de verdade, a proposta criada pela automação apareceria
-- sem autor e o histórico diria "usuário removido".
--
-- POR QUE NÃO É MIGRATION
-- Depende de `auth.users`, que é dado, não schema. Migration cria
-- estrutura; este arquivo cria uma linha. Mesma separação de
-- criar_usuario_admin.sql e dos seeds.
--
-- POR QUE NÃO TEM auth.identities
-- De propósito: sem a identidade do provider 'email', este usuário NÃO
-- consegue fazer login. É uma conta de serviço — ela só precisa existir
-- para ser referenciada por FK. A senha é aleatória e ninguém a conhece.
-- Se um dia alguém precisar logar como a automação (não deveria), o
-- caminho é criar_usuario_admin.sql, não afrouxar este arquivo.
--
-- LIMITAÇÃO CONHECIDA (multi-empresa)
-- `profiles.empresa_id` é NOT NULL e `auth.users.email` é único, então
-- existe UM profile de serviço, numa empresa só. Num banco com várias
-- empresas, usuários das outras veriam "usuário removido" no histórico
-- das propostas criadas pela automação, porque a RLS de `profiles` filtra
-- por empresa. Hoje isso é teórico (gc-dev tem uma empresa); quando
-- deixar de ser, a correção é um profile de serviço por empresa e a
-- ingestão resolvendo o autor por `empresa_id`. Registrado no documento
-- de entrega.
--
-- Idempotente: rodar de novo não duplica nem troca o uuid.
-- ============================================================

do $$
declare
  -- ---------- PARÂMETROS ----------
  v_email   text := 'automacao@obraminds.com';
  v_nome    text := 'Automação (Telegram)';
  -- Menor privilégio que ainda enxerga dado. A automação NÃO escreve
  -- pela sessão deste usuário — a rota de ingestão usa a service key e
  -- faz a checagem de empresa/obra por conta própria (Fase 6). Este
  -- perfil existe só para dar um autor legível na tela.
  v_perfil  text := 'visualizador';
  v_empresa text := null;   -- nome da empresa; null = a que já tem profiles
  -- --------------------------------

  v_uid uuid;
  v_empresa_id uuid;
  v_novo boolean := false;
begin
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
    raise exception 'Nenhuma empresa encontrada (procurado: %). Crie a empresa antes.',
      coalesce(v_empresa, '<a que tiver profiles>');
  end if;

  select id into v_uid from auth.users where email = v_email;

  if v_uid is null then
    v_uid := gen_random_uuid();
    v_novo := true;

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      -- O GoTrue lê estas colunas como texto e quebra com
      -- "Database error querying schema" se vierem NULL.
      confirmation_token, recovery_token, email_change,
      email_change_token_new, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      v_email,
      -- Senha aleatória e descartada: esta conta não loga.
      extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('nome', v_nome, 'conta_de_servico', true),
      '', '', '', '', '', '', '', ''
    );
  end if;

  -- SEM insert em auth.identities — ver cabeçalho.

  insert into profiles (id, empresa_id, nome, email, perfil, ativo)
  values (v_uid, v_empresa_id, v_nome, v_email, v_perfil, true)
  on conflict (id) do update
    set empresa_id = excluded.empresa_id,
        nome       = excluded.nome,
        email      = excluded.email,
        perfil     = excluded.perfil,
        ativo      = true,
        updated_at = now();

  raise notice '% profile de serviço % (uuid %) como % na empresa %',
    case when v_novo then 'Criado' else 'Atualizado' end,
    v_email, v_uid, v_perfil, v_empresa_id;
  raise notice 'Anote o uuid: a Fase 6 precisa dele em INGESTAO_PROFILE_ID no .env.local';
end $$;

-- ============================================================
-- Verificação — deve voltar 1 linha, com pode_logar = false
-- ============================================================
select
  p.id           as uuid_para_o_env_local,
  p.nome,
  p.email,
  p.perfil,
  p.ativo,
  e.nome         as empresa,
  exists (select 1 from auth.identities i where i.user_id = p.id) as pode_logar
from profiles p
join empresas e on e.id = p.empresa_id
where p.email = 'automacao@obraminds.com';

-- ============================================================
-- CLEANUP (colar no SQL Editor; não roda automaticamente)
-- ============================================================
-- Só funciona se nenhuma proposta apontar para ele em created_by.
-- delete from profiles  where email = 'automacao@obraminds.com';
-- delete from auth.users where email = 'automacao@obraminds.com';
