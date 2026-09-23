-- ============================================================
-- 014_contatos_canal.sql
-- ============================================================
-- Fase 1 da migração de canal WhatsApp (Z-API) → Telegram, e do
-- caminho "proposta chega no canal → aparece cadastrada no sistema".
-- Plano: docs/tecnicos/migracao-telegram-integracao-automacao.md
-- (Fase 1; decisões 4, 6, 7, 9 e 12 da Seção 4).
--
-- Três coisas acontecem aqui, e vale entender por que juntas:
--
-- 1. `contatos_whatsapp` deixa de ser uma tabela de telefones e vira
--    uma tabela de CONTATOS DE CANAL. O Telegram não entrega telefone
--    — entrega um `chat_id` numérico opaco —, então `telefone` deixa
--    de ser obrigatório e a unicidade passa a ser POR CANAL.
--    A tabela NÃO é renomeada: renomear quebraria os 4 nós n8n que a
--    consultam no exato instante em que a migration roda. O rename
--    para `contatos_canal` é item opcional da Fase 8, depois do corte.
--
-- 2. `documentos_processamento` ganha `canal`/`canal_chat_id` e para
--    de depender de `dados_extraidos->>'telefone'` como chave de
--    correlação resposta↔documento. Essa dependência é o item 4 da
--    Seção 0.3 do plano: é o que quebraria em silêncio na troca de
--    canal, porque o `Buscar Documento Pendente` do n8n casa por ela.
--
-- 3. `documentos_processamento.proposta_criada_id`, o espelho do
--    `contrato_criado_id` que já existia. Sem ele não há como saber
--    qual proposta veio de qual documento, nem como tornar a rota de
--    ingestão da Fase 6 idempotente.
--
-- O que esta migration NÃO faz, de propósito:
--   - Não mexe no CHECK de `documentos_processamento.status`. O valor
--     `PROPOSTA_REGISTRADA` que o workflow 4b escreve hoje não está no
--     CHECK e portanto falha. A decisão 6 do plano é ESPELHAR o que o
--     workflow de contrato (dOt8aiCX2OCr08RH) escreve, e isso exige
--     abrir o n8n. Enquanto não for conferido, o CHECK fica como está
--     — acrescentar um valor sem saber se ele é necessário criaria um
--     status órfão que ninguém escreve.
--   - Não cria coluna nova em `propostas` nem em `itens`. A Seção 0.8
--     do plano confirma que o schema já comporta a proposta e os itens
--     vindos do OCR; o que falta lá é regra de aplicação, não schema.
--   - Não cria o profile de serviço da automação (decisão 12). Isso
--     depende de `auth.users`, que não é schema — vai em
--     supabase/criar_usuario_automacao.sql, aplicado à parte.
--
-- Aditiva e reversível; o rollback está no fim do arquivo, comentado.
-- Tudo em transação única, como as migrations 008-011: sem isso, uma
-- falha no meio deixa metade aplicada e o arquivo não é idempotente
-- para retomar de onde parou.
-- ============================================================

begin;

-- ============================================================
-- 1. contatos_whatsapp — identidade por canal
-- ============================================================

alter table contatos_whatsapp
  add column if not exists canal text not null default 'WHATSAPP',
  add column if not exists telegram_chat_id text;

comment on column contatos_whatsapp.canal is
  'Canal pelo qual este contato fala com a automação. Define QUAL coluna '
  'de identidade vale: telefone (WHATSAPP) ou telegram_chat_id (TELEGRAM).';
comment on column contatos_whatsapp.telegram_chat_id is
  'chat_id do Telegram, numérico mas guardado como text: a Bot API não '
  'garante caber em int64 com folga e o valor nunca é usado em conta. '
  'Grupos têm chat_id negativo.';

alter table contatos_whatsapp
  drop constraint if exists contatos_whatsapp_canal_check;
alter table contatos_whatsapp
  add constraint contatos_whatsapp_canal_check
  check (canal in ('WHATSAPP', 'TELEGRAM'));

-- Telegram não entrega telefone (Seção 3.1 do plano): a coluna deixa de
-- ser obrigatória. Quem garante que a identidade existe é o CHECK de
-- coerência logo abaixo, não o NOT NULL.
alter table contatos_whatsapp
  alter column telefone drop not null;

-- O `unique` global de telefone vira unicidade POR CANAL. Sem isso, dois
-- contatos de Telegram (ambos com telefone nulo) conviveriam, mas dois
-- telefones iguais em canais diferentes também — e o lookup do n8n casa
-- por canal + identidade.
alter table contatos_whatsapp
  drop constraint if exists contatos_whatsapp_telefone_key;

create unique index if not exists idx_contatos_telefone_whatsapp
  on contatos_whatsapp (telefone)
  where canal = 'WHATSAPP';

create unique index if not exists idx_contatos_chat_id_telegram
  on contatos_whatsapp (telegram_chat_id)
  where canal = 'TELEGRAM';

-- Coerência: a coluna de identidade do canal declarado tem de estar
-- preenchida. É o que impede um contato de Telegram sem chat_id, que
-- passaria no schema e sumiria silenciosamente do lookup.
alter table contatos_whatsapp
  drop constraint if exists contatos_whatsapp_identidade_do_canal;
alter table contatos_whatsapp
  add constraint contatos_whatsapp_identidade_do_canal
  check (
    (canal = 'WHATSAPP' and telefone is not null)
    or (canal = 'TELEGRAM' and telegram_chat_id is not null)
  );

-- FK composta, como o resto do schema multi-tenant.
-- Antes: `obra_id uuid references obras(id)` — FK SIMPLES, a única do
-- schema que não amarra empresa junto. Do jeito que estava, nada impedia
-- vincular um contato à obra de OUTRA empresa, e o canal é justamente
-- por onde entra dado não conferido. `obras` tem `unique (id, empresa_id)`
-- exatamente para isto.
-- MATCH SIMPLE: com obra_id nulo a FK não é checada, que é o
-- comportamento desejado (obra ainda não confirmada → REVISAO_HUMANA).
alter table contatos_whatsapp
  drop constraint if exists contatos_whatsapp_obra_id_fkey;
alter table contatos_whatsapp
  drop constraint if exists contatos_whatsapp_obra_fk;
alter table contatos_whatsapp
  add constraint contatos_whatsapp_obra_fk
  foreign key (obra_id, empresa_id) references obras(id, empresa_id)
  on delete restrict;

create index if not exists idx_contatos_whatsapp_canal
  on contatos_whatsapp (canal);

-- ============================================================
-- 2. documentos_processamento — canal e vínculo com a proposta
-- ============================================================

alter table documentos_processamento
  add column if not exists canal text,
  add column if not exists canal_chat_id text;

comment on column documentos_processamento.canal is
  'Por onde o documento chegou. Junto com canal_chat_id substitui '
  'dados_extraidos->>''telefone'' como chave de correlação '
  'resposta↔documento (Seção 0.3 do plano, item 4).';
comment on column documentos_processamento.canal_chat_id is
  'Identidade de quem enviou, no canal: telefone E.164 no WHATSAPP, '
  'chat_id no TELEGRAM.';

alter table documentos_processamento
  drop constraint if exists documentos_processamento_canal_check;
alter table documentos_processamento
  add constraint documentos_processamento_canal_check
  check (canal is null or canal in ('WHATSAPP', 'TELEGRAM'));

-- Espelho de contrato_criado_id, que já existe. Composta de propósito,
-- ao contrário do irmão: a coluna é nova, não há dado para migrar, e
-- `propostas` tem `unique (id, empresa_id)`. Amarrar empresa aqui custa
-- nada agora e impede um documento apontar para proposta de outra
-- empresa. O contrato_criado_id fica como está — mexer nele é risco sem
-- pedido, e está registrado como observação no documento de entrega.
alter table documentos_processamento
  add column if not exists proposta_criada_id uuid;

comment on column documentos_processamento.proposta_criada_id is
  'Proposta criada a partir deste documento pela rota de ingestão '
  '(Fase 6). É a chave de idempotência: preenchido = já processado.';

alter table documentos_processamento
  drop constraint if exists documentos_processamento_proposta_criada_fk;
alter table documentos_processamento
  add constraint documentos_processamento_proposta_criada_fk
  foreign key (proposta_criada_id, empresa_id)
  references propostas(id, empresa_id)
  on delete set null (proposta_criada_id);

create index if not exists idx_documentos_processamento_canal_chat
  on documentos_processamento (canal, canal_chat_id);

create index if not exists idx_documentos_processamento_proposta
  on documentos_processamento (proposta_criada_id);

-- ============================================================
-- 3. Backfill
-- ============================================================
-- Todo documento existente chegou por WhatsApp — o Telegram ainda não
-- existe. O chat_id do canal é o telefone que ficou preso no JSON.
-- `where canal is null` mantém idempotente: rodar de novo não mexe em
-- linha já classificada.

update documentos_processamento
   set canal = 'WHATSAPP',
       canal_chat_id = dados_extraidos ->> 'telefone'
 where canal is null;

-- ============================================================
-- 4. Verificação — falha alto, não em silêncio
-- ============================================================
-- A migration acima usa `drop constraint if exists` com nomes
-- auto-gerados pelo Postgres (contatos_whatsapp_telefone_key,
-- contatos_whatsapp_obra_id_fkey). Se algum nome divergir do esperado,
-- o `if exists` vira um no-op MUDO e a migration "passa" deixando a
-- constraint velha de pé — exatamente o modo de falhar que a
-- auditoria-cobertura-sprint-4.md documenta. Este bloco transforma esse
-- no-op em erro: como está tudo na mesma transação, qualquer raise aqui
-- desfaz o arquivo inteiro.

do $$
declare
  n int;
begin
  -- 4.1 o unique global de telefone tem de ter sumido
  select count(*) into n
    from pg_constraint
   where conrelid = 'contatos_whatsapp'::regclass
     and contype = 'u'
     and pg_get_constraintdef(oid) ilike '%(telefone)%';
  if n > 0 then
    raise exception 'contatos_whatsapp ainda tem unique global em telefone (% constraint(s)) — o drop não pegou o nome certo', n;
  end if;

  -- 4.2 os dois uniques parciais por canal têm de existir
  select count(*) into n
    from pg_indexes
   where tablename = 'contatos_whatsapp'
     and indexname in ('idx_contatos_telefone_whatsapp', 'idx_contatos_chat_id_telegram');
  if n <> 2 then
    raise exception 'esperados 2 uniques parciais por canal, encontrados %', n;
  end if;

  -- 4.3 a FK de obra tem de ser composta (2 colunas)
  select coalesce(cardinality(conkey), 0) into n
    from pg_constraint
   where conrelid = 'contatos_whatsapp'::regclass
     and contype = 'f'
     and confrelid = 'obras'::regclass;
  if n <> 2 then
    raise exception 'FK contatos_whatsapp→obras tem % coluna(s), esperado 2 (composta com empresa_id)', n;
  end if;

  -- 4.4 telefone tem de ser nullable
  select count(*) into n
    from information_schema.columns
   where table_name = 'contatos_whatsapp'
     and column_name = 'telefone'
     and is_nullable = 'YES';
  if n <> 1 then
    raise exception 'contatos_whatsapp.telefone continua NOT NULL';
  end if;

  -- 4.5 backfill: nenhum documento pode ter ficado sem canal
  select count(*) into n from documentos_processamento where canal is null;
  if n > 0 then
    raise exception 'backfill incompleto: % documento(s) sem canal', n;
  end if;

  raise notice 'contatos_canal: 5/5 verificações OK';
end $$;

commit;

-- ============================================================
-- ROLLBACK (colar no SQL Editor; não roda automaticamente)
-- ============================================================
-- begin;
-- alter table documentos_processamento
--   drop constraint if exists documentos_processamento_proposta_criada_fk,
--   drop constraint if exists documentos_processamento_canal_check,
--   drop column if exists proposta_criada_id,
--   drop column if exists canal_chat_id,
--   drop column if exists canal;
-- drop index if exists idx_contatos_telefone_whatsapp;
-- drop index if exists idx_contatos_chat_id_telegram;
-- drop index if exists idx_contatos_whatsapp_canal;
-- alter table contatos_whatsapp
--   drop constraint if exists contatos_whatsapp_identidade_do_canal,
--   drop constraint if exists contatos_whatsapp_canal_check,
--   drop constraint if exists contatos_whatsapp_obra_fk,
--   drop column if exists telegram_chat_id,
--   drop column if exists canal;
-- -- cuidado: o passo abaixo só funciona se não houver telefone nulo
-- alter table contatos_whatsapp alter column telefone set not null;
-- alter table contatos_whatsapp add constraint contatos_whatsapp_telefone_key unique (telefone);
-- alter table contatos_whatsapp
--   add constraint contatos_whatsapp_obra_id_fkey foreign key (obra_id) references obras(id);
-- commit;
