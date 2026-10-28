-- ============================================================
-- Envio de documentos pelo grupo do Telegram (trilha da automação,
-- decisões 33 a 36 de docs/automacao/migracao-telegram-integracao-automacao.md)
-- ============================================================
-- 1. contatos_whatsapp.ativo: revogar o envio sem apagar a pessoa.
-- 2. bot_grupos: grupos do Telegram em que o bot aceita documento. O grupo
--    se registra sozinho (PENDENTE) quando uma pessoa liberada chama o bot
--    nele; o admin libera ou bloqueia em Configurações → Bot → Grupos.
-- 3. bot_pedidos_acesso: quem mandou PDF num grupo liberado sem estar
--    liberado. Um por pessoa por empresa; o admin permite ou recusa.
--    (Não confundir com pedidos_acesso, o "esqueci minha senha" do login.)
-- 4. documentos_processamento: quem mandou (canal_remetente_id) e a
--    mensagem do PDF (canal_mensagem_id). No grupo, canal_chat_id é o
--    grupo, e o bot responde em citação à mensagem original.
--
-- Quem grava em bot_grupos e bot_pedidos_acesso é a rota de triagem, com a
-- chave de serviço: não há policy de insert nem de delete. O admin lê e
-- muda o status. Aditiva; rollback comentado no fim.
-- ============================================================

begin;

-- 1. contatos_whatsapp ---------------------------------------
alter table contatos_whatsapp
  add column if not exists ativo boolean not null default true;

comment on column contatos_whatsapp.ativo is
  'Falso = a pessoa não pode mais mandar documentos ao bot (conversa privada '
  'e grupos). Revoga sem apagar o cadastro.';

-- 2. bot_grupos ----------------------------------------------
create table if not exists bot_grupos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  telegram_chat_id text not null,
  nome text check (nome is null or char_length(nome) <= 200),
  status text not null default 'PENDENTE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bot_grupos_status_check
    check (status in ('PENDENTE', 'LIBERADO', 'BLOQUEADO')),
  constraint bot_grupos_chat_id_formato
    check (telegram_chat_id ~ '^-\d{5,20}$'),
  constraint bot_grupos_id_empresa_key unique (id, empresa_id)
);

comment on table bot_grupos is
  'Grupos do Telegram em que o bot aceita documento de pessoa liberada.';
comment on column bot_grupos.telegram_chat_id is
  'chat.id do grupo (negativo; supergrupo começa com -100). Único no banco: '
  'um grupo pertence a uma empresa.';
comment on column bot_grupos.nome is 'Título do grupo no Telegram quando foi registrado.';

create unique index if not exists idx_bot_grupos_chat_id on bot_grupos (telegram_chat_id);
create index if not exists idx_bot_grupos_empresa_status on bot_grupos (empresa_id, status);

drop trigger if exists trg_bot_grupos_updated on bot_grupos;
create trigger trg_bot_grupos_updated
  before update on bot_grupos
  for each row execute function update_updated_at();

-- 3. bot_pedidos_acesso --------------------------------------
create table if not exists bot_pedidos_acesso (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  telegram_user_id text not null,
  nome text not null check (char_length(nome) between 1 and 200),
  telegram_username text check (telegram_username is null or char_length(telegram_username) <= 64),
  grupo_id uuid,
  status text not null default 'PENDENTE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bot_pedidos_acesso_status_check
    check (status in ('PENDENTE', 'APROVADO', 'RECUSADO')),
  constraint bot_pedidos_acesso_usuario_formato
    check (telegram_user_id ~ '^\d{5,20}$'),
  constraint bot_pedidos_acesso_empresa_usuario_key unique (empresa_id, telegram_user_id),
  constraint bot_pedidos_acesso_grupo_fk
    foreign key (grupo_id, empresa_id) references bot_grupos(id, empresa_id)
    on delete set null (grupo_id)
);

comment on table bot_pedidos_acesso is
  'Quem mandou PDF num grupo liberado sem estar em Usuários permitidos. '
  'Um por pessoa por empresa. Não é pedidos_acesso (senha do login).';
comment on column bot_pedidos_acesso.telegram_user_id is
  'from.id de quem pediu. Ao permitir, vira contatos_whatsapp.telegram_chat_id.';
comment on column bot_pedidos_acesso.grupo_id is 'Grupo em que a pessoa tentou mandar.';

create index if not exists idx_bot_pedidos_acesso_empresa_status
  on bot_pedidos_acesso (empresa_id, status, created_at desc);

drop trigger if exists trg_bot_pedidos_acesso_updated on bot_pedidos_acesso;
create trigger trg_bot_pedidos_acesso_updated
  before update on bot_pedidos_acesso
  for each row execute function update_updated_at();

-- 4. documentos_processamento --------------------------------
alter table documentos_processamento
  add column if not exists canal_remetente_id text,
  add column if not exists canal_mensagem_id bigint;

comment on column documentos_processamento.canal_remetente_id is
  'from.id de quem mandou pelo Telegram. Na conversa privada é igual a '
  'canal_chat_id; no grupo, canal_chat_id é o grupo.';
comment on column documentos_processamento.canal_mensagem_id is
  'message_id do PDF no grupo, para o bot responder em citação. Nulo na '
  'conversa privada e nos documentos anteriores.';

-- 5. Auditoria: as duas tabelas novas entram no trigger genérico ----
drop trigger if exists trg_bot_grupos_auditoria on bot_grupos;
create trigger trg_bot_grupos_auditoria
  after insert or update or delete on bot_grupos
  for each row execute function auditar_mudanca();

drop trigger if exists trg_bot_pedidos_acesso_auditoria on bot_pedidos_acesso;
create trigger trg_bot_pedidos_acesso_auditoria
  after insert or update or delete on bot_pedidos_acesso
  for each row execute function auditar_mudanca();

-- 6. RLS: só admin, da própria empresa. Sem insert e sem delete. ----
alter table bot_grupos enable row level security;
alter table bot_pedidos_acesso enable row level security;

drop policy if exists "Grupos do bot: admin lê os da empresa" on bot_grupos;
create policy "Grupos do bot: admin lê os da empresa" on bot_grupos
  for select using (empresa_id = current_empresa_id() and has_perfil(array['admin']));

drop policy if exists "Grupos do bot: admin muda o status" on bot_grupos;
create policy "Grupos do bot: admin muda o status" on bot_grupos
  for update
  using (empresa_id = current_empresa_id() and has_perfil(array['admin']))
  with check (empresa_id = current_empresa_id() and has_perfil(array['admin']));

drop policy if exists "Pedidos do bot: admin lê os da empresa" on bot_pedidos_acesso;
create policy "Pedidos do bot: admin lê os da empresa" on bot_pedidos_acesso
  for select using (empresa_id = current_empresa_id() and has_perfil(array['admin']));

drop policy if exists "Pedidos do bot: admin muda o status" on bot_pedidos_acesso;
create policy "Pedidos do bot: admin muda o status" on bot_pedidos_acesso
  for update
  using (empresa_id = current_empresa_id() and has_perfil(array['admin']))
  with check (empresa_id = current_empresa_id() and has_perfil(array['admin']));

-- 7. Verificação: falha alto ----------------------------------
do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_name = 'contatos_whatsapp' and column_name = 'ativo';
  if n <> 1 then raise exception 'contatos_whatsapp.ativo não foi criada'; end if;

  select count(*) into n from information_schema.columns
   where table_name = 'documentos_processamento'
     and column_name in ('canal_remetente_id', 'canal_mensagem_id');
  if n <> 2 then raise exception 'documentos_processamento: esperadas 2 colunas novas, encontradas %', n; end if;

  select count(*) into n from pg_policies
   where tablename in ('bot_grupos', 'bot_pedidos_acesso');
  if n <> 4 then raise exception 'esperadas 4 policies nas tabelas do bot, encontradas %', n; end if;

  select count(*) into n from pg_policies
   where tablename in ('bot_grupos', 'bot_pedidos_acesso') and cmd in ('INSERT', 'DELETE', 'ALL');
  if n <> 0 then raise exception 'tabela do bot com policy de insert/delete (% policy(s))', n; end if;

  select count(*) into n from pg_trigger
   where tgname in ('trg_bot_grupos_auditoria', 'trg_bot_pedidos_acesso_auditoria');
  if n <> 2 then raise exception 'esperados 2 triggers de auditoria, encontrados %', n; end if;

  raise notice 'bot_envio_pelo_grupo: 5/5 verificações OK';
end $$;

commit;

-- ROLLBACK (colar no SQL Editor; não roda sozinho)
-- begin;
-- drop table if exists bot_pedidos_acesso;
-- drop table if exists bot_grupos;
-- alter table documentos_processamento
--   drop column if exists canal_mensagem_id,
--   drop column if exists canal_remetente_id;
-- alter table contatos_whatsapp drop column if exists ativo;
-- commit;
