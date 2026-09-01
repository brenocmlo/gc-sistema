-- ============================================================
-- 009_contatos_whatsapp.sql
-- ============================================================
-- Suporte ao canal de ingestão via WhatsApp (Z-API): mapeia o
-- telefone de quem manda o documento para empresa_id/obra_id/
-- numero_contrato, pra o workflow n8n "Obraminds - Ingestão via
-- WhatsApp (Z-API)" resolver o vínculo sem a IA precisar adivinhar.
--
-- Se o telefone não estiver cadastrado aqui, o workflow segue com
-- empresa_id/obra_id vazios e o documento cai em REVISAO_HUMANA
-- pela mesma checagem de vínculo do fluxo principal (nunca é
-- descartado) — ver relatorios/md/roadmap_zapi_integracao.md e
-- fluxo_e_campos_extracao.md (Seção 1.3) no projeto keen-mendel.
-- ============================================================

create table contatos_whatsapp (
  id uuid primary key default uuid_generate_v4(),
  telefone text not null unique,
  empresa_id uuid not null references empresas(id) on delete cascade,
  obra_id uuid references obras(id),         -- nulo = telefone conhecido, obra ainda não confirmada (cai em REVISAO_HUMANA)
  numero_contrato text,                      -- opcional; se ausente, a IA tenta extrair do próprio documento

  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid references profiles(id)
);

create index idx_contatos_whatsapp_empresa on contatos_whatsapp(empresa_id);
create index idx_contatos_whatsapp_obra on contatos_whatsapp(obra_id);

-- updated_at automático (mesma função criada em 001_initial.sql)
create trigger trg_contatos_whatsapp_updated
  before update on contatos_whatsapp
  for each row execute function update_updated_at();

-- ============================================================
-- RLS — mesmo padrão de `documentos_processamento` (008):
--   admin     → CRUD
--   comercial → CRU (não exclui)
--   demais    → SELECT (compartilhado dentro da empresa)
--   delete    → só admin
-- O service_role (usado pelo n8n via sb_secret_key) sempre bypassa RLS,
-- então essas policies só afetam o acesso pelo painel.
-- ============================================================

alter table contatos_whatsapp enable row level security;

drop policy if exists "Contatos WhatsApp: ver da empresa" on contatos_whatsapp;
drop policy if exists "Contatos WhatsApp: criar (admin/comercial)" on contatos_whatsapp;
drop policy if exists "Contatos WhatsApp: atualizar (admin/comercial)" on contatos_whatsapp;
drop policy if exists "Contatos WhatsApp: excluir (admin)" on contatos_whatsapp;

create policy "Contatos WhatsApp: ver da empresa" on contatos_whatsapp
  for select using (empresa_id = current_empresa_id());

create policy "Contatos WhatsApp: criar (admin/comercial)" on contatos_whatsapp
  for insert with check (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'comercial'])
  );

create policy "Contatos WhatsApp: atualizar (admin/comercial)" on contatos_whatsapp
  for update using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'comercial'])
  );

create policy "Contatos WhatsApp: excluir (admin)" on contatos_whatsapp
  for delete using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin'])
  );
