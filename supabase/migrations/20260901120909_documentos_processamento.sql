-- ============================================================
-- 008_documentos_processamento.sql
-- ============================================================
-- Tabela central da automação de OCR/IA (n8n): guarda o PDF em
-- triagem e o JSON extraído pela IA antes de qualquer gravação
-- oficial em `contratos`/`itens`. Nunca foi criada nas migrations
-- 001-007 — o levantamento de requisitos e o schema do painel
-- andaram em paralelo.
--
-- Colunas obra_id / numero_contrato / contrato_criado_id / motivo_revisao
-- foram adicionadas em relação ao desenho original do levantamento,
-- pra bater com as regras reais de `contratos` (obra_id NOT NULL,
-- numero NOT NULL único por empresa) — ver
-- relatorios/empecilhos_implementacao_n8n.md no projeto keen-mendel.
-- Tudo dentro de uma única transação (atomic): sem isso, uma falha no
-- meio (um index, uma policy) deixa a tabela criada e o resto faltando,
-- e o script não é idempotente pra retomar de onde parou.
-- ============================================================

begin;

create table documentos_processamento (
  id uuid primary key default uuid_generate_v4(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  tipo_documento text not null check (tipo_documento in ('PROPOSTA', 'CONTRATO')),
  arquivo_url text not null,
  dados_extraidos jsonb,
  status text not null default 'PENDENTE'
    check (status in ('PENDENTE', 'ERRO_VALIDACAO', 'REVISAO_HUMANA', 'APROVADO')),

  -- Adições necessárias pro workflow n8n funcionar contra o schema real:
  obra_id uuid references obras(id),                -- confirmado pelo humano no upload
  numero_contrato text,                             -- extraído pela IA ou confirmado pelo humano
  contrato_criado_id uuid references contratos(id), -- preenchido após a integração (Fase 3)
  motivo_revisao text,                              -- por que foi pra REVISAO_HUMANA (divergência? obra ausente?)

  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid references profiles(id)
);

create index idx_documentos_processamento_empresa on documentos_processamento(empresa_id);
create index idx_documentos_processamento_status on documentos_processamento(status);
create index idx_documentos_processamento_obra on documentos_processamento(obra_id);

-- updated_at automático (reaproveita a função criada em 001_initial.sql)
create trigger trg_documentos_processamento_updated
  before update on documentos_processamento
  for each row execute function update_updated_at();

-- ============================================================
-- RLS — mesmo padrão de permissão usado em `clientes` (005_rls_clientes.sql):
--   admin     → CRUD
--   comercial → CRU (não exclui)
--   demais    → SELECT (compartilhado dentro da empresa)
--   delete    → só admin
-- O service_role (usado pelo n8n via sb_secret_key) sempre bypassa RLS,
-- então essas policies só afetam o acesso pelo painel.
-- ============================================================

alter table documentos_processamento enable row level security;

drop policy if exists "Documentos processamento: ver da empresa" on documentos_processamento;
drop policy if exists "Documentos processamento: criar (admin/comercial)" on documentos_processamento;
drop policy if exists "Documentos processamento: atualizar (admin/comercial)" on documentos_processamento;
drop policy if exists "Documentos processamento: excluir (admin)" on documentos_processamento;

create policy "Documentos processamento: ver da empresa" on documentos_processamento
  for select using (empresa_id = current_empresa_id());

create policy "Documentos processamento: criar (admin/comercial)" on documentos_processamento
  for insert with check (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'comercial'])
  );

create policy "Documentos processamento: atualizar (admin/comercial)" on documentos_processamento
  for update using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'comercial'])
  );

create policy "Documentos processamento: excluir (admin)" on documentos_processamento
  for delete using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin'])
  );

commit;
