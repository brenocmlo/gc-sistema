-- ============================================================
-- STORAGE BUCKETS (arquivos: anexos, evidências, NFs)
-- Versão: 003_storage_buckets
-- ============================================================
-- IMPORTANTE: rode 001_initial.sql e 002_rls_policies.sql antes.
--
-- Este arquivo cria os 4 buckets de arquivos do sistema e
-- suas políticas de acesso.
-- ============================================================

-- ============================================================
-- 1. CRIAR BUCKETS
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'anexos',
    'anexos',
    false,
    20971520, -- 20 MB
    array['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel', 'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
  ),
  (
    'evidencias',
    'evidencias',
    false,
    20971520,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']
  ),
  (
    'notas-fiscais',
    'notas-fiscais',
    false,
    10485760, -- 10 MB
    array['application/pdf', 'application/xml', 'text/xml']
  ),
  (
    'documentos',
    'documentos',
    false,
    20971520,
    array['application/pdf', 'image/jpeg', 'image/png',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
  )
on conflict (id) do nothing;

-- ============================================================
-- 2. POLÍTICAS DE ACESSO AOS BUCKETS
-- ============================================================
-- Estrutura de pastas esperada:
--   anexos/{empresa_id}/{entidade}/{id}/arquivo.pdf
--   evidencias/{empresa_id}/{obra_id}/{item_id}/arquivo.jpg
--   notas-fiscais/{empresa_id}/{obra_id}/nfXXX.pdf
--   documentos/{empresa_id}/{obra_id}/doc.pdf
--
-- O primeiro segmento do path DEVE ser o empresa_id do usuário.

-- Helper: retorna o primeiro segmento do path (deve ser empresa_id)
create or replace function storage_empresa_id_from_path(path text)
returns uuid
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select nullif(split_part(path, '/', 1), '')::uuid;
$$;

-- ============================================================
-- Drop policies existentes (pra rodar idempotente em dev)
-- ============================================================
do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname in (
        'Anexos: ver só da própria empresa',
        'Anexos: upload na própria empresa',
        'Anexos: atualizar próprios',
        'Anexos: admin/dono exclui',
        'Evidências: ver só da própria empresa',
        'Evidências: upload produção/medição/financeiro',
        'Evidências: atualizar próprias',
        'Evidências: admin/dono exclui',
        'NFs: ver só da própria empresa',
        'NFs: financeiro faz upload',
        'NFs: financeiro atualiza',
        'NFs: admin exclui',
        'Documentos: ver só da própria empresa',
        'Documentos: comercial/admin fazem upload',
        'Documentos: comercial atualiza',
        'Documentos: admin exclui'
      )
  loop
    execute format('drop policy if exists %I on storage.objects', pol.policyname);
  end loop;
end $$;

-- ============================================================
-- Bucket: anexos
-- ============================================================
create policy "Anexos: ver só da própria empresa" on storage.objects
  for select using (
    bucket_id = 'anexos'
    and storage_empresa_id_from_path(name) = current_empresa_id()
  );

create policy "Anexos: upload na própria empresa" on storage.objects
  for insert with check (
    bucket_id = 'anexos'
    and storage_empresa_id_from_path(name) = current_empresa_id()
    and has_perfil(array['admin', 'comercial', 'producao', 'medicao', 'financeiro'])
  );

create policy "Anexos: atualizar próprios" on storage.objects
  for update using (
    bucket_id = 'anexos'
    and storage_empresa_id_from_path(name) = current_empresa_id()
    and owner = auth.uid()
  );

create policy "Anexos: admin/dono exclui" on storage.objects
  for delete using (
    bucket_id = 'anexos'
    and storage_empresa_id_from_path(name) = current_empresa_id()
    and (has_perfil(array['admin']) or owner = auth.uid())
  );

-- ============================================================
-- Bucket: evidencias (execução, FD)
-- ============================================================
create policy "Evidências: ver só da própria empresa" on storage.objects
  for select using (
    bucket_id = 'evidencias'
    and storage_empresa_id_from_path(name) = current_empresa_id()
  );

create policy "Evidências: upload produção/medição/financeiro" on storage.objects
  for insert with check (
    bucket_id = 'evidencias'
    and storage_empresa_id_from_path(name) = current_empresa_id()
    and has_perfil(array['admin', 'producao', 'medicao', 'financeiro'])
  );

create policy "Evidências: atualizar próprias" on storage.objects
  for update using (
    bucket_id = 'evidencias'
    and storage_empresa_id_from_path(name) = current_empresa_id()
    and owner = auth.uid()
  );

create policy "Evidências: admin/dono exclui" on storage.objects
  for delete using (
    bucket_id = 'evidencias'
    and storage_empresa_id_from_path(name) = current_empresa_id()
    and (has_perfil(array['admin']) or owner = auth.uid())
  );

-- ============================================================
-- Bucket: notas-fiscais
-- ============================================================
create policy "NFs: ver só da própria empresa" on storage.objects
  for select using (
    bucket_id = 'notas-fiscais'
    and storage_empresa_id_from_path(name) = current_empresa_id()
  );

create policy "NFs: financeiro faz upload" on storage.objects
  for insert with check (
    bucket_id = 'notas-fiscais'
    and storage_empresa_id_from_path(name) = current_empresa_id()
    and has_perfil(array['admin', 'financeiro'])
  );

create policy "NFs: financeiro atualiza" on storage.objects
  for update using (
    bucket_id = 'notas-fiscais'
    and storage_empresa_id_from_path(name) = current_empresa_id()
    and has_perfil(array['admin', 'financeiro'])
  );

create policy "NFs: admin exclui" on storage.objects
  for delete using (
    bucket_id = 'notas-fiscais'
    and storage_empresa_id_from_path(name) = current_empresa_id()
    and has_perfil(array['admin'])
  );

-- ============================================================
-- Bucket: documentos (propostas, contratos, ARTs etc)
-- ============================================================
create policy "Documentos: ver só da própria empresa" on storage.objects
  for select using (
    bucket_id = 'documentos'
    and storage_empresa_id_from_path(name) = current_empresa_id()
  );

create policy "Documentos: comercial/admin fazem upload" on storage.objects
  for insert with check (
    bucket_id = 'documentos'
    and storage_empresa_id_from_path(name) = current_empresa_id()
    and has_perfil(array['admin', 'comercial'])
  );

create policy "Documentos: comercial atualiza" on storage.objects
  for update using (
    bucket_id = 'documentos'
    and storage_empresa_id_from_path(name) = current_empresa_id()
    and has_perfil(array['admin', 'comercial'])
  );

create policy "Documentos: admin exclui" on storage.objects
  for delete using (
    bucket_id = 'documentos'
    and storage_empresa_id_from_path(name) = current_empresa_id()
    and has_perfil(array['admin'])
  );

-- ============================================================
-- FIM DOS BUCKETS
-- ============================================================
-- Resumo dos buckets:
--
-- anexos         → anexos de orçamentos, propostas, contratos (PDFs, Excel, Word, imagens)
-- evidencias     → fotos e PDFs de evidências de execução e FD
-- notas-fiscais  → PDFs e XMLs de notas fiscais emitidas
-- documentos     → contratos assinados, ARTs, procurações, cronogramas
--
-- Todos são PRIVADOS (não acessíveis publicamente).
-- Acesso via URL assinada temporária gerada pelo Supabase Client.
-- ============================================================
