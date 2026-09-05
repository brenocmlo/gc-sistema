-- ============================================================
-- 005_rls_clientes.sql — políticas RLS faltantes na tabela clientes
-- ============================================================
-- A tabela `clientes` foi criada na migration 004 mas sem as
-- policies de RLS, o que bloqueava SELECT/INSERT/UPDATE/DELETE
-- via supabase-js (service_role do SQL Editor bypassa RLS).
--
-- Permissões: igual ao funil comercial.
--   admin     → CRUD
--   comercial → CRU
--   demais    → SELECT (compartilhado)
--   delete    → só admin
-- ============================================================

alter table clientes enable row level security;

drop policy if exists "Clientes: ver da empresa" on clientes;
drop policy if exists "Clientes: criar (admin/comercial)" on clientes;
drop policy if exists "Clientes: atualizar (admin/comercial)" on clientes;
drop policy if exists "Clientes: excluir (admin)" on clientes;

create policy "Clientes: ver da empresa" on clientes
  for select using (empresa_id = current_empresa_id());

create policy "Clientes: criar (admin/comercial)" on clientes
  for insert with check (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'comercial'])
  );

create policy "Clientes: atualizar (admin/comercial)" on clientes
  for update using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'comercial'])
  );

create policy "Clientes: excluir (admin)" on clientes
  for delete using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin'])
  );
