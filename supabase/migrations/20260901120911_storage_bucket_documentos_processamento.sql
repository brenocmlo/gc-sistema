-- ============================================================
-- 010_storage_bucket_documentos_processamento.sql
-- ============================================================
-- Bucket de Storage pro reenvio de arquivos da automação de
-- OCR/IA (n8n) — staging do PDF antes/durante a triagem em
-- `documentos_processamento` (008). Nome escolhido pra bater com
-- a mesma raiz da tabela (padrão já usado no projeto: bucket
-- singular-ao-tema, kebab-case, ex. `notas-fiscais` ~ tabela
-- relacionada a notas fiscais).
--
-- Requer 003_storage_buckets.sql já aplicado (usa a mesma função
-- helper `storage_empresa_id_from_path`).
--
-- Este bucket é PRIVADO (mesmo padrão dos outros 4 — ver 003). As
-- policies abaixo exigem que o primeiro segmento do path seja o
-- `empresa_id` — o workflow n8n "Obraminds - Ingestão via WhatsApp
-- (Z-API)" já foi ajustado em 05/08/2026 pra bater com isso: o
-- upload grava em `{empresa_id}/whatsapp/{messageId}-{fileName}`
-- e a `arquivo_url` final vem de uma signed URL (node "Supabase -
-- Criar Signed URL"), não de uma URL pública montada na mão.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documentos-processamento',
  'documentos-processamento',
  false,
  20971520, -- 20 MB
  array['application/pdf']
)
on conflict (id) do nothing;

-- ============================================================
-- Políticas de acesso — mesmo padrão do bucket `documentos` (003):
-- path esperado: documentos-processamento/{empresa_id}/...
-- ============================================================

drop policy if exists "Docs processamento: ver só da própria empresa" on storage.objects;
drop policy if exists "Docs processamento: comercial/admin fazem upload" on storage.objects;
drop policy if exists "Docs processamento: comercial atualiza" on storage.objects;
drop policy if exists "Docs processamento: admin exclui" on storage.objects;

create policy "Docs processamento: ver só da própria empresa" on storage.objects
  for select using (
    bucket_id = 'documentos-processamento'
    and storage_empresa_id_from_path(name) = current_empresa_id()
  );

create policy "Docs processamento: comercial/admin fazem upload" on storage.objects
  for insert with check (
    bucket_id = 'documentos-processamento'
    and storage_empresa_id_from_path(name) = current_empresa_id()
    and has_perfil(array['admin', 'comercial'])
  );

create policy "Docs processamento: comercial atualiza" on storage.objects
  for update using (
    bucket_id = 'documentos-processamento'
    and storage_empresa_id_from_path(name) = current_empresa_id()
    and has_perfil(array['admin', 'comercial'])
  );

create policy "Docs processamento: admin exclui" on storage.objects
  for delete using (
    bucket_id = 'documentos-processamento'
    and storage_empresa_id_from_path(name) = current_empresa_id()
    and has_perfil(array['admin'])
  );

-- ============================================================
-- Nota: o n8n usa a service_role key (sb_secret_key) nos nodes
-- HTTP, que sempre bypassa RLS — as policies acima só valem pro
-- acesso via painel (usuário autenticado), caso alguém precise
-- abrir o PDF original durante uma revisão manual.
-- ============================================================
