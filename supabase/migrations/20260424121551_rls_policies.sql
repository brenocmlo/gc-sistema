-- ============================================================
-- RLS POLICIES (Row Level Security)
-- Versão: 002_rls_policies
-- ============================================================
-- IMPORTANTE: rode 001_initial.sql antes deste arquivo.
--
-- Este arquivo implementa a segurança do sistema:
-- 1. Isolamento por empresa (tenant) — impossível ver dados de outra empresa
-- 2. Permissões por perfil — cada perfil vê/edita só o que precisa
-- ============================================================

-- Habilitar RLS em todas as tabelas
alter table empresas enable row level security;
alter table profiles enable row level security;
alter table orcamentos enable row level security;
alter table obras enable row level security;
alter table propostas enable row level security;
alter table contratos enable row level security;
alter table itens enable row level security;
alter table execucao enable row level security;
alter table notas_fiscais enable row level security;
alter table pagamentos enable row level security;
alter table acordos_pagamento enable row level security;
alter table acordo_parcelas enable row level security;
alter table fd enable row level security;

-- ============================================================
-- EMPRESAS
-- ============================================================
-- Usuário vê APENAS sua própria empresa
create policy "Usuário vê própria empresa" on empresas
  for select using (id = current_empresa_id());

-- Só admin pode editar dados da empresa
create policy "Admin edita empresa" on empresas
  for update using (id = current_empresa_id() and has_perfil(array['admin']));

-- ============================================================
-- PROFILES (usuários)
-- ============================================================
-- Todo mundo da empresa vê perfis da empresa (pra saber quem é quem)
create policy "Usuários veem perfis da empresa" on profiles
  for select using (empresa_id = current_empresa_id());

-- Admin cria/edita/desativa perfis da própria empresa
create policy "Admin gerencia perfis da empresa" on profiles
  for all using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin'])
  );

-- Usuário atualiza próprio perfil (nome, foto) — mas não muda perfil/empresa
create policy "Usuário edita próprio perfil" on profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and empresa_id = current_empresa_id());

-- ============================================================
-- ORÇAMENTOS — comercial, admin veem/editam; resto só lê
-- ============================================================
create policy "Orçamentos: tenant isolation" on orcamentos
  for select using (empresa_id = current_empresa_id());

create policy "Orçamentos: comercial edita" on orcamentos
  for insert with check (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'comercial'])
  );

create policy "Orçamentos: comercial atualiza" on orcamentos
  for update using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'comercial'])
  );

create policy "Orçamentos: admin exclui" on orcamentos
  for delete using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin'])
  );

-- ============================================================
-- OBRAS — comercial e admin criam/editam; produção, medição e financeiro leem
-- ============================================================
create policy "Obras: tenant isolation" on obras
  for select using (empresa_id = current_empresa_id());

create policy "Obras: comercial cria" on obras
  for insert with check (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'comercial'])
  );

create policy "Obras: comercial atualiza" on obras
  for update using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'comercial'])
  );

create policy "Obras: admin exclui" on obras
  for delete using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin'])
  );

-- ============================================================
-- PROPOSTAS — comercial e admin
-- ============================================================
create policy "Propostas: tenant isolation" on propostas
  for select using (empresa_id = current_empresa_id());

create policy "Propostas: comercial insere" on propostas
  for insert with check (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'comercial'])
  );

create policy "Propostas: comercial atualiza" on propostas
  for update using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'comercial'])
  );

create policy "Propostas: admin exclui" on propostas
  for delete using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin'])
  );

-- ============================================================
-- CONTRATOS — comercial e admin
-- ============================================================
create policy "Contratos: tenant isolation" on contratos
  for select using (empresa_id = current_empresa_id());

create policy "Contratos: comercial insere" on contratos
  for insert with check (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'comercial'])
  );

create policy "Contratos: comercial atualiza" on contratos
  for update using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'comercial'])
  );

create policy "Contratos: admin exclui" on contratos
  for delete using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin'])
  );

-- ============================================================
-- ITENS — comercial cadastra, produção/medição leem, admin tudo
-- ============================================================
create policy "Itens: tenant isolation" on itens
  for select using (empresa_id = current_empresa_id());

create policy "Itens: comercial insere" on itens
  for insert with check (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'comercial'])
  );

create policy "Itens: comercial edita" on itens
  for update using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'comercial'])
  );

create policy "Itens: admin exclui" on itens
  for delete using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin'])
  );

-- ============================================================
-- EXECUÇÃO — produção, medição e admin editam; resto lê
-- ============================================================
create policy "Execução: tenant isolation" on execucao
  for select using (empresa_id = current_empresa_id());

create policy "Execução: produção/medição/admin inserem" on execucao
  for insert with check (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'producao', 'medicao'])
  );

create policy "Execução: produção/medição/admin atualizam" on execucao
  for update using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'producao', 'medicao'])
  );

create policy "Execução: admin exclui" on execucao
  for delete using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin'])
  );

-- ============================================================
-- NOTAS FISCAIS — financeiro e admin
-- ============================================================
create policy "NFs: tenant isolation" on notas_fiscais
  for select using (empresa_id = current_empresa_id());

create policy "NFs: financeiro insere" on notas_fiscais
  for insert with check (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'financeiro'])
  );

create policy "NFs: financeiro atualiza" on notas_fiscais
  for update using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'financeiro'])
  );

create policy "NFs: admin exclui" on notas_fiscais
  for delete using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin'])
  );

-- ============================================================
-- PAGAMENTOS — financeiro e admin
-- ============================================================
create policy "Pagamentos: tenant isolation" on pagamentos
  for select using (empresa_id = current_empresa_id());

create policy "Pagamentos: financeiro gerencia" on pagamentos
  for all using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'financeiro'])
  );

-- ============================================================
-- ACORDOS DE PAGAMENTO — financeiro e admin
-- ============================================================
create policy "Acordos: tenant isolation" on acordos_pagamento
  for select using (empresa_id = current_empresa_id());

create policy "Acordos: financeiro gerencia" on acordos_pagamento
  for all using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'financeiro'])
  );

-- ============================================================
-- PARCELAS DE ACORDO — financeiro e admin
-- ============================================================
create policy "Parcelas: tenant isolation" on acordo_parcelas
  for select using (empresa_id = current_empresa_id());

create policy "Parcelas: financeiro gerencia" on acordo_parcelas
  for all using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'financeiro'])
  );

-- ============================================================
-- FATURAMENTO DIRETO — financeiro e admin
-- ============================================================
create policy "FD: tenant isolation" on fd
  for select using (empresa_id = current_empresa_id());

create policy "FD: financeiro gerencia" on fd
  for all using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'financeiro'])
  );

-- ============================================================
-- FIM DAS POLÍTICAS RLS
-- ============================================================
-- Resumo da matriz de permissões:
--
-- Perfil        | Orç | Obra| Prop| Cont| Item| Exec| NF  | Pag | Acrd| FD
-- --------------|-----|-----|-----|-----|-----|-----|-----|-----|-----|----
-- admin         | CRUD| CRUD| CRUD| CRUD| CRUD| CRUD| CRUD| CRUD| CRUD| CRUD
-- comercial     | CRU | CRU | CRU | CRU | CRU | R   | R   | R   | R   | R
-- producao      | R   | R   | R   | R   | R   | CRU | R   | R   | R   | R
-- medicao       | R   | R   | R   | R   | R   | CRU | R   | R   | R   | R
-- financeiro    | R   | R   | R   | R   | R   | R   | CRU | CRU | CRU | CRU
-- visualizador  | R   | R   | R   | R   | R   | R   | R   | R   | R   | R
--
-- C=Create, R=Read, U=Update, D=Delete
-- Delete sempre restrito ao admin
-- ============================================================
