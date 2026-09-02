-- ============================================================
-- verificar_schema_aplicado.sql  —  SOMENTE LEITURA
-- ============================================================
-- Diagnóstico do bloco 4.1 (sincronizar schema dev/prod).
--
-- O repositório não usa `supabase/migrations` nem a CLI, então não
-- existe tabela de controle (schema_migrations) dizendo o que já
-- rodou. Este script infere o estado a partir do catálogo do
-- Postgres: cada linha é uma evidência de que a migration 004..010
-- foi (ou não) aplicada.
--
-- COMO USAR:
--   1. Abrir o SQL Editor do projeto gc-dev  → colar → Run.
--   2. Abrir o SQL Editor do projeto gc-prod → colar → Run.
--   3. Comparar as duas saídas linha por linha.
--
-- Não altera nada: só SELECT em catálogos. Seguro rodar em prod.
-- ============================================================

with checagens as (

  -- ---------- 004_revisao_schema ----------
  select '004' as mig, 'tabela clientes existe' as checagem,
         (to_regclass('public.clientes') is not null)::text as encontrado,
         'true' as esperado
  union all
  select '004', 'obras.cliente_id existe e é NOT NULL',
         coalesce((
           select a.attnotnull::text
           from pg_attribute a
           where a.attrelid = to_regclass('public.obras')
             and a.attname = 'cliente_id' and a.attnum > 0 and not a.attisdropped
         ), 'ausente'),
         'true'
  union all
  select '004', 'constraint obras_cliente_fk existe',
         (exists (
           select 1 from pg_constraint
           where conname = 'obras_cliente_fk' and conrelid = to_regclass('public.obras')
         ))::text,
         'true'
  union all
  select '004', 'colunas legacy de obras dropadas (esperado 0 restantes)',
         (select count(*)::text from information_schema.columns
          where table_schema = 'public' and table_name = 'obras'
            and column_name in ('cliente','contato','cpf_cnpj','telefone','email',
                                'valor_total','desconto','valor_final','pct_sinal',
                                'pct_fd','pct_entrega_material','pct_medicao_instalacao',
                                'forma_pagamento','doc_url')),
         '0'
  union all
  select '004', 'obras.observacoes renomeada para observacao',
         (exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='obras' and column_name='observacao')
          and not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='obras' and column_name='observacoes'))::text,
         'true'
  union all
  select '004', 'colunas legacy de orcamentos dropadas (esperado 0)',
         (select count(*)::text from information_schema.columns
          where table_schema='public' and table_name='orcamentos'
            and column_name in ('cliente_nome','cliente_contato','cliente_telefone',
                                'cliente_email','cliente_cidade','doc_url')),
         '0'
  union all
  select '004', 'orcamentos.cliente_id existe',
         (exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='orcamentos' and column_name='cliente_id'))::text,
         'true'
  union all
  select '004', 'views recriadas (obras_com_valores, contratos_financeiro, propostas_financeiro, itens_com_status)',
         (select count(*)::text from pg_views
          where schemaname='public'
            and viewname in ('obras_com_valores','contratos_financeiro','propostas_financeiro','itens_com_status')),
         '4'

  -- ---------- 005_rls_clientes ----------
  union all
  select '005', 'RLS habilitado em clientes',
         coalesce((select relrowsecurity::text from pg_class
                   where oid = to_regclass('public.clientes')), 'tabela ausente'),
         'true'
  union all
  select '005', 'policies em clientes',
         (select count(*)::text from pg_policies
          where schemaname='public' and tablename='clientes'),
         '4'

  -- ---------- 006_fix_calcular_valores_obra ----------
  union all
  select '006', 'calcular_valores_obra contém o CASO 2 (fonte=sem_proposta)',
         coalesce((
           select (pg_get_functiondef(p.oid) like '%sem_proposta%')::text
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'calcular_valores_obra'
           limit 1
         ), 'função ausente'),
         'true'

  -- ---------- 007_progresso_itens_obra ----------
  union all
  select '007', 'obras_com_valores expõe progresso_itens_pct',
         (exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='obras_com_valores'
                    and column_name='progresso_itens_pct'))::text,
         'true'

  -- ---------- 008_documentos_processamento ----------
  union all
  select '008', 'tabela documentos_processamento existe',
         (to_regclass('public.documentos_processamento') is not null)::text,
         'true'
  union all
  select '008', 'RLS habilitado em documentos_processamento',
         coalesce((select relrowsecurity::text from pg_class
                   where oid = to_regclass('public.documentos_processamento')), 'tabela ausente'),
         'true'
  union all
  select '008', 'policies em documentos_processamento',
         (select count(*)::text from pg_policies
          where schemaname='public' and tablename='documentos_processamento'),
         '4'
  union all
  select '008', 'indexes de documentos_processamento',
         (select count(*)::text from pg_indexes
          where schemaname='public' and tablename='documentos_processamento'
            and indexname in ('idx_documentos_processamento_empresa',
                              'idx_documentos_processamento_status',
                              'idx_documentos_processamento_obra')),
         '3'

  -- ---------- 009_contatos_whatsapp ----------
  union all
  select '009', 'tabela contatos_whatsapp existe',
         (to_regclass('public.contatos_whatsapp') is not null)::text,
         'true'
  union all
  select '009', 'RLS habilitado em contatos_whatsapp',
         coalesce((select relrowsecurity::text from pg_class
                   where oid = to_regclass('public.contatos_whatsapp')), 'tabela ausente'),
         'true'
  union all
  select '009', 'policies em contatos_whatsapp',
         (select count(*)::text from pg_policies
          where schemaname='public' and tablename='contatos_whatsapp'),
         '4'

  -- ---------- 010_storage_bucket_documentos_processamento ----------
  union all
  select '010', 'bucket documentos-processamento existe (privado, 20MB, application/pdf)',
         coalesce((
           select (not public and file_size_limit = 20971520
                   and allowed_mime_types @> array['application/pdf'])::text
           from storage.buckets where id = 'documentos-processamento'
         ), 'bucket ausente'),
         'true'
  union all
  select '010', 'policies "Docs processamento%" em storage.objects',
         (select count(*)::text from pg_policies
          where schemaname='storage' and tablename='objects'
            and policyname like 'Docs processamento%'),
         '4'

  -- ---------- Contexto extra (não é pass/fail) ----------
  union all
  select 'info', 'bucket documentos (migration 003) existe',
         (exists (select 1 from storage.buckets where id = 'documentos'))::text,
         'true'
  union all
  select 'info', 'total de tabelas em public',
         (select count(*)::text from pg_tables where schemaname='public'),
         '(comparar dev vs prod)'
  union all
  select 'info', 'total de policies em public',
         (select count(*)::text from pg_policies where schemaname='public'),
         '(comparar dev vs prod)'
)
select
  mig            as "migration",
  case
    when esperado like '(%' then 'ℹ️  INFO'
    when encontrado = esperado then '✅ OK'
    else '❌ FALTA'
  end            as "status",
  checagem       as "checagem",
  esperado       as "esperado",
  encontrado     as "encontrado"
from checagens
order by mig, checagem;
