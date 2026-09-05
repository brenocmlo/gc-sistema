-- ============================================================
-- SISTEMA DE GESTÃO DE CONTRATOS
-- Schema inicial - PostgreSQL / Supabase
-- Versão: 001_initial
-- ============================================================
-- INSTRUÇÕES DE USO:
-- 1. Acesse seu projeto Supabase → SQL Editor
-- 2. Cole este arquivo inteiro e execute (botão Run)
-- 3. Depois, execute 002_rls_policies.sql
-- 4. Por último, execute 003_storage_buckets.sql
-- ============================================================
-- IDEMPOTÊNCIA:
--
-- Este arquivo NÃO é idempotente (é intencional) — se rodar uma
-- segunda vez, vai falhar com "relation already exists". Isso é
-- uma proteção contra re-execução acidental em produção.
--
-- Se precisar recomeçar do zero EM AMBIENTE DE DEV, use o
-- arquivo `000_reset_dev.sql` antes de rodar este.
--
-- EM PRODUÇÃO: se precisar alterar o schema depois de instalado,
-- crie uma migração incremental (ex: `004_add_campo_x.sql`) com
-- apenas o ALTER/CREATE necessário — NUNCA re-rode o 001.
-- ============================================================
-- REQUISITOS:
--
-- PostgreSQL 15 ou superior — este schema usa a sintaxe
-- `ON DELETE SET NULL (column_list)` em FKs compostas, que só
-- existe a partir do PG 15. Supabase usa PG 15+ em todos os
-- projetos criados recentemente, então está compatível.
-- ============================================================

-- Habilitar extensões necessárias
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================
-- 1. TABELAS DE SISTEMA (multi-tenant + perfis)
-- ============================================================

-- Empresas (tenant isolation). No seu caso inicial, só 1 empresa.
-- Mas deixamos pronto pra escalar.
create table empresas (
  id uuid primary key default uuid_generate_v4(),
  nome text not null,
  cnpj text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Perfis de usuário (estende auth.users do Supabase)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  empresa_id uuid not null references empresas(id) on delete restrict,
  nome text not null,
  email text not null,
  perfil text not null check (perfil in ('admin', 'comercial', 'producao', 'medicao', 'financeiro', 'visualizador')),
  ativo boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_profiles_empresa on profiles(empresa_id);
create index idx_profiles_perfil on profiles(perfil);

-- ============================================================
-- 2. ORÇAMENTOS (funil comercial - fase 1)
-- ============================================================

create table orcamentos (
  id uuid primary key default uuid_generate_v4(),
  empresa_id uuid not null references empresas(id) on delete cascade,

  -- Identificação
  numero text,
  data_solicitacao date not null default current_date,

  -- Cliente (pode não ter obra cadastrada ainda)
  cliente_nome text not null,
  cliente_contato text,
  cliente_telefone text,
  cliente_email text,
  cliente_cidade text,

  -- Vinculação opcional a obra existente
  obra_id uuid, -- FK adicionada depois após criação da tabela obras

  -- Escopo
  descricao text,
  escopo_resumo text,
  valor_estimado numeric(14,2) default 0 check (valor_estimado >= 0),
  prazo_estimado text,

  -- Status e decisão
  status text not null default 'pendente' check (status in ('pendente', 'analise', 'enviado', 'aprovado', 'rejeitado', 'expirado')),
  data_envio date,
  data_decisao date,

  -- Motivo categorizado (obrigatório se rejeitado)
  motivo_rejeicao text check (motivo_rejeicao in (
    'preco_alto', 'prazo_curto', 'perdeu_concorrente', 'cliente_desistiu',
    'sem_resposta', 'escopo_mudou', 'sem_capacidade', 'outro'
  )),
  detalhe_rejeicao text,

  -- Meta
  responsavel text,
  observacao text,
  doc_url text,
  anexos jsonb default '[]'::jsonb,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid references profiles(id),

  -- Constraint: se rejeitado, precisa de motivo
  constraint orcamento_rejeitado_motivo check (
    status != 'rejeitado' or motivo_rejeicao is not null
  )
);

create index idx_orcamentos_empresa on orcamentos(empresa_id);
create index idx_orcamentos_status on orcamentos(status);
create index idx_orcamentos_obra on orcamentos(obra_id);
create index idx_orcamentos_data on orcamentos(data_solicitacao desc);

-- Unicidade de numero por empresa, APENAS quando preenchido
-- (numero em orçamento é opcional; rascunhos sem numero não violam unique)
create unique index idx_orcamentos_numero_unique
  on orcamentos (empresa_id, numero)
  where numero is not null;

-- ============================================================
-- 3. OBRAS (cadastro de obras/projetos)
-- ============================================================

create table obras (
  id uuid primary key default uuid_generate_v4(),
  empresa_id uuid not null references empresas(id) on delete cascade,

  codigo_obra text not null,
  nome text not null,
  status text not null default 'ativa' check (status in ('ativa', 'concluida', 'suspensa', 'cancelada')),

  -- Cliente
  cliente text,
  contato text,
  cpf_cnpj text,
  telefone text,
  email text,
  endereco text,
  cidade text,
  cep text,

  -- Comercial
  prazo_execucao text,
  data_inicio date,
  data_prevista_fim date,
  data_real_fim date,

  -- Valores (legacy - hoje vem dos contratos e/ou propostas ativas)
  -- valor_final é calculado automaticamente: valor_total - desconto
  valor_total numeric(14,2) not null default 0 check (valor_total >= 0),
  desconto numeric(14,2) not null default 0 check (desconto >= 0),
  valor_final numeric(14,2) generated always as (valor_total - desconto) stored,

  -- Condições de pagamento (legacy - hoje vem dos contratos e/ou propostas ativas)
  -- Percentuais entre 0 e 1 (0% a 100%)
  pct_sinal numeric(5,4) default 0 check (pct_sinal between 0 and 1),
  pct_fd numeric(5,4) default 0 check (pct_fd between 0 and 1),
  pct_entrega_material numeric(5,4) default 0 check (pct_entrega_material between 0 and 1),
  pct_medicao_instalacao numeric(5,4) default 0 check (pct_medicao_instalacao between 0 and 1),

  forma_pagamento text,
  observacoes text,
  doc_url text,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid references profiles(id),

  unique (empresa_id, codigo_obra),
  unique (id, empresa_id),  -- usado por FKs compostas nas tabelas filhas (integridade multi-tenant)

  -- Desconto não pode exceder o valor total
  constraint obras_desconto_valido check (desconto <= valor_total)
);

create index idx_obras_empresa on obras(empresa_id);
create index idx_obras_status on obras(status);
create index idx_obras_cliente on obras(cliente);

-- Agora podemos adicionar a FK composta em orcamentos → obras
-- (orçamento e obra vinculada precisam ser da mesma empresa)
alter table orcamentos
  add constraint orcamentos_obra_fk
  foreign key (obra_id, empresa_id) references obras(id, empresa_id) on delete set null (obra_id);

-- ============================================================
-- 4. PROPOSTAS (uma obra pode ter várias)
-- ============================================================

create table propostas (
  id uuid primary key default uuid_generate_v4(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  obra_id uuid not null,

  numero text not null,
  descricao text,

  data_emissao date default current_date,
  data_validade date,

  -- Valores: valor_final é calculado automaticamente (valor_total - desconto)
  valor_total numeric(14,2) not null default 0 check (valor_total >= 0),
  desconto numeric(14,2) not null default 0 check (desconto >= 0),
  valor_final numeric(14,2) generated always as (valor_total - desconto) stored,

  status text not null default 'rascunho' check (status in ('rascunho', 'enviada', 'aprovada', 'rejeitada')),

  -- Condições de pagamento estruturadas (pra cálculos e relatórios)
  -- Percentuais entre 0 e 1 (0% a 100%)
  pct_sinal numeric(5,4) default 0 check (pct_sinal between 0 and 1),
  pct_fd numeric(5,4) default 0 check (pct_fd between 0 and 1),
  pct_entrega_material numeric(5,4) default 0 check (pct_entrega_material between 0 and 1),
  pct_medicao_instalacao numeric(5,4) default 0 check (pct_medicao_instalacao between 0 and 1),

  -- Condições livres (nuances que não cabem em percentual)
  condicoes_pagamento text,

  observacao text,
  doc_url text,
  anexos jsonb default '[]'::jsonb,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid references profiles(id),

  -- FK composta: obra vinculada precisa ser da mesma empresa
  -- RESTRICT: não permite deletar obra que tenha propostas (use status='cancelada')
  constraint propostas_obra_fk
    foreign key (obra_id, empresa_id) references obras(id, empresa_id) on delete restrict,

  -- Desconto não pode exceder o valor total
  constraint propostas_desconto_valido check (desconto <= valor_total),

  -- Para que tabelas filhas possam referenciar (id, empresa_id) via FK composta
  unique (id, empresa_id),
  -- Para que filhas possam referenciar (id, empresa_id, obra_id) — garante mesma obra
  unique (id, empresa_id, obra_id),

  -- Número de proposta é único por empresa (não pode duplicar)
  unique (empresa_id, numero)
);

create index idx_propostas_empresa on propostas(empresa_id);
create index idx_propostas_obra on propostas(obra_id);
create index idx_propostas_status on propostas(status);

-- ============================================================
-- 5. CONTRATOS (opcional, pode vir de proposta)
-- ============================================================

create table contratos (
  id uuid primary key default uuid_generate_v4(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  obra_id uuid not null,
  proposta_origem_id uuid,

  numero text not null,
  descricao text,

  data_assinatura date,
  prazo_execucao text,

  valor_total numeric(14,2) not null default 0 check (valor_total >= 0),
  status text not null default 'ativo' check (status in ('ativo', 'concluido', 'suspenso', 'rescindido')),

  -- Condições de pagamento estruturadas
  -- Percentuais entre 0 e 1 (0% a 100%)
  pct_sinal numeric(5,4) default 0 check (pct_sinal between 0 and 1),
  pct_fd numeric(5,4) default 0 check (pct_fd between 0 and 1),
  pct_entrega_material numeric(5,4) default 0 check (pct_entrega_material between 0 and 1),
  pct_medicao_instalacao numeric(5,4) default 0 check (pct_medicao_instalacao between 0 and 1),

  -- Condições livres
  condicoes_pagamento text,

  observacao text,
  doc_url text,
  anexos jsonb default '[]'::jsonb,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid references profiles(id),

  -- FKs compostas: obra e proposta de origem precisam ser da mesma empresa E mesma obra
  -- RESTRICT em obra: não deletar obra que tenha contratos (use status)
  constraint contratos_obra_fk
    foreign key (obra_id, empresa_id) references obras(id, empresa_id) on delete restrict,
  constraint contratos_proposta_fk
    foreign key (proposta_origem_id, empresa_id, obra_id) references propostas(id, empresa_id, obra_id) on delete set null (proposta_origem_id),

  unique (id, empresa_id),
  unique (id, empresa_id, obra_id),

  -- Número de contrato é único por empresa
  unique (empresa_id, numero)
);

create index idx_contratos_empresa on contratos(empresa_id);
create index idx_contratos_obra on contratos(obra_id);
create index idx_contratos_status on contratos(status);
create index idx_contratos_proposta on contratos(proposta_origem_id);

-- ============================================================
-- 6. ITENS (vinculados a contrato OU proposta, XOR)
-- ============================================================

create table itens (
  id uuid primary key default uuid_generate_v4(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  obra_id uuid not null,

  -- Vínculo mutuamente exclusivo (um ou outro, ou nenhum = "solto")
  proposta_id uuid,
  contrato_id uuid,

  numero integer,
  tipo text,
  descricao text,
  linha text,
  acabamento text,

  -- Dimensões
  largura numeric(10,3) default 0 check (largura >= 0),
  altura numeric(10,3) default 0 check (altura >= 0),
  quantidade numeric(10,3) default 0 check (quantidade >= 0),
  area_m2 numeric(12,4) default 0 check (area_m2 >= 0),
  unidade text default 'QTD' check (unidade in ('QTD', 'M2', 'ML')),

  -- Localização e descrição técnica
  localizacao text,
  vidros text,
  foto_url text,

  -- Valores
  valor_unit numeric(14,2) default 0 check (valor_unit >= 0),
  valor_total numeric(14,2) default 0 check (valor_total >= 0),

  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid references profiles(id),

  -- FKs compostas: todas as entidades vinculadas precisam ser da mesma empresa E mesma obra
  -- RESTRICT em obra: preserva histórico de itens
  constraint itens_obra_fk
    foreign key (obra_id, empresa_id) references obras(id, empresa_id) on delete restrict,
  constraint itens_proposta_fk
    foreign key (proposta_id, empresa_id, obra_id) references propostas(id, empresa_id, obra_id) on delete set null (proposta_id),
  constraint itens_contrato_fk
    foreign key (contrato_id, empresa_id, obra_id) references contratos(id, empresa_id, obra_id) on delete set null (contrato_id),

  -- XOR: item NUNCA pode estar vinculado a proposta E contrato ao mesmo tempo
  constraint item_vinculo_xor check (
    (proposta_id is null) or (contrato_id is null)
  ),

  unique (id, empresa_id)
);

create index idx_itens_empresa on itens(empresa_id);
create index idx_itens_obra on itens(obra_id);
create index idx_itens_proposta on itens(proposta_id);
create index idx_itens_contrato on itens(contrato_id);

-- ============================================================
-- 7. EXECUÇÃO (4 etapas por item: fabricação → entrega → instalação → medição)
-- ============================================================
-- Cada item tem UMA linha de execução com QUANTIDADES PARCIAIS por etapa.
-- O fluxo natural é: fabricado → entregue → instalado → medido pelo cliente.
--
-- Regras (forçadas pelo banco via CHECK constraints):
--   ent_qtd <= fab_qtd  (não pode entregar mais do que fabricou)
--   inst_qtd <= ent_qtd (não pode instalar mais do que entregou)
--   med_qtd <= inst_qtd (não pode medir mais do que instalou)
--   todas as qtd <= itens.quantidade (não pode exceder o total do item)
--
-- Status de cada etapa é GENERATED automaticamente:
--   qtd = 0                  → 'pendente'
--   0 < qtd < quantidade     → 'andamento'
--   qtd = quantidade         → 'concluido'
--
-- Datas de cada etapa (preenchidas via TRIGGER quando a qtd muda):
--   *_data_inicio        → quando a qtd saiu de 0 pela primeira vez
--   *_data_atualizacao   → toda vez que a qtd é alterada
--   *_data_fim           → quando a qtd alcançou a quantidade total
-- ============================================================

create table execucao (
  id uuid primary key default uuid_generate_v4(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  item_id uuid not null,

  -- Quantidade total do item (desnormalizada via trigger ao criar a linha)
  -- Permite os checks de cascata (ent_qtd <= fab_qtd <= quantidade_total)
  -- Sincronizada com itens.quantidade via trigger
  quantidade_total numeric(10,3) not null check (quantidade_total >= 0),

  -- ========== FABRICAÇÃO ==========
  fab_qtd numeric(10,3) not null default 0
    check (fab_qtd >= 0 and fab_qtd <= quantidade_total),
  -- Status derivado da quantidade
  fab_status text generated always as (
    case
      when fab_qtd = 0 then 'pendente'
      when fab_qtd >= quantidade_total then 'concluido'
      else 'andamento'
    end
  ) stored,
  fab_data_inicio date,         -- preenchida via trigger (primeira vez fora de 0)
  fab_data_atualizacao date,    -- preenchida via trigger (cada update da qtd)
  fab_data_fim date,            -- preenchida via trigger (quando alcança total)
  fab_responsavel text,
  fab_observacao text,

  -- ========== ENTREGA ==========
  ent_qtd numeric(10,3) not null default 0
    check (ent_qtd >= 0 and ent_qtd <= fab_qtd),
  ent_status text generated always as (
    case
      when ent_qtd = 0 then 'pendente'
      when ent_qtd >= quantidade_total then 'concluido'
      else 'andamento'
    end
  ) stored,
  ent_data_inicio date,
  ent_data_atualizacao date,
  ent_data_fim date,
  ent_responsavel text,
  ent_observacao text,

  -- ========== INSTALAÇÃO ==========
  inst_qtd numeric(10,3) not null default 0
    check (inst_qtd >= 0 and inst_qtd <= ent_qtd),
  inst_status text generated always as (
    case
      when inst_qtd = 0 then 'pendente'
      when inst_qtd >= quantidade_total then 'concluido'
      else 'andamento'
    end
  ) stored,
  inst_data_inicio date,
  inst_data_atualizacao date,
  inst_data_fim date,
  inst_responsavel text,
  inst_observacao text,

  -- ========== MEDIÇÃO (validação final com o cliente) ==========
  med_qtd numeric(10,3) not null default 0
    check (med_qtd >= 0 and med_qtd <= inst_qtd),
  med_status text generated always as (
    case
      when med_qtd = 0 then 'pendente'
      when med_qtd >= quantidade_total then 'concluido'
      else 'andamento'
    end
  ) stored,
  med_data_inicio date,
  med_data_atualizacao date,
  med_data_fim date,
  med_responsavel text,
  med_observacao text,

  -- Evidências (fotos, PDFs, docs) como JSON array
  -- Cada evidência: {nome, url, tipo, data, observacao, etapa: 'fabricacao'|'entrega'|'instalacao'|'medicao'}
  evidencias jsonb default '[]'::jsonb,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique (item_id), -- 1 execução por item

  -- FK composta: item vinculado precisa ser da mesma empresa
  constraint execucao_item_fk
    foreign key (item_id, empresa_id) references itens(id, empresa_id) on delete cascade
);

create index idx_execucao_empresa on execucao(empresa_id);
create index idx_execucao_item on execucao(item_id);
create index idx_execucao_fab_status on execucao(fab_status);
create index idx_execucao_med_status on execucao(med_status);

-- ============================================================
-- 8. NOTAS FISCAIS (emitidas pela obra)
-- ============================================================
-- NF pode estar vinculada a:
--   - Um contrato (caso comum)
--   - Uma proposta (ex: sinal antes do contrato assinar)
--   - Nenhum dos dois (FD, avulsa, legado)
-- Vínculos são mutuamente exclusivos.
--
-- IMPORTANTE: NF não se vincula a item específico.
-- Faturamento é controlado no nível da obra/contrato/proposta.
-- ============================================================

create table notas_fiscais (
  id uuid primary key default uuid_generate_v4(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  obra_id uuid not null,

  -- Vínculo XOR: contrato OU proposta OU nenhum
  contrato_id uuid,
  proposta_id uuid,

  numero text not null,
  serie text,
  data_emissao date not null default current_date,
  data_vencimento date,

  tipo text not null check (tipo in ('sinal', 'entrega_material', 'medicao', 'instalacao', 'fat_direto', 'outro')),

  valor_total numeric(14,2) not null check (valor_total > 0),

  status text not null default 'emitida' check (status in ('emitida', 'parcial', 'paga', 'cancelada')),

  observacao text,
  xml_url text,
  pdf_url text,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid references profiles(id),

  -- FKs compostas (multi-tenant + mesma obra)
  -- RESTRICT em obra: NFs têm implicação fiscal, nunca deletadas por cascata
  constraint nf_obra_fk
    foreign key (obra_id, empresa_id) references obras(id, empresa_id) on delete restrict,
  constraint nf_contrato_fk
    foreign key (contrato_id, empresa_id, obra_id) references contratos(id, empresa_id, obra_id) on delete set null (contrato_id),
  constraint nf_proposta_fk
    foreign key (proposta_id, empresa_id, obra_id) references propostas(id, empresa_id, obra_id) on delete set null (proposta_id),

  -- XOR: NF não pode estar vinculada a proposta E contrato ao mesmo tempo
  constraint nf_vinculo_xor check (
    (proposta_id is null) or (contrato_id is null)
  ),

  unique (id, empresa_id),
  unique (id, empresa_id, obra_id)
);

create index idx_notas_empresa on notas_fiscais(empresa_id);
create index idx_notas_obra on notas_fiscais(obra_id);
create index idx_notas_contrato on notas_fiscais(contrato_id);
create index idx_notas_proposta on notas_fiscais(proposta_id);
create index idx_notas_status on notas_fiscais(status);
create index idx_notas_data on notas_fiscais(data_emissao desc);

-- Unicidade de numero + serie por empresa
-- COALESCE(serie, '') trata serie nullable como string vazia
-- (sem isso, NULLs seriam considerados distintos e permitiriam duplicatas)
create unique index idx_notas_numero_serie_unique
  on notas_fiscais (empresa_id, numero, coalesce(serie, ''));

-- ============================================================
-- 9. PAGAMENTOS (entrada de dinheiro - NF, parcela de acordo, ou avulso)
-- ============================================================
-- Pagamento sempre representa uma entrada de dinheiro real, vinculada a:
--   - Uma NF (caso comum: cliente pagou contra a NF)
--   - Uma PARCELA de acordo (cliente pagou uma combinação específica)
--   - Nada (avulso: entrou dinheiro sem NF nem acordo)
--
-- A FK pra acordo_parcelas é adicionada DEPOIS, porque a tabela
-- acordo_parcelas é criada mais abaixo.
-- ============================================================

create table pagamentos (
  id uuid primary key default uuid_generate_v4(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  obra_id uuid not null,

  -- Vinculação: NF OU parcela de acordo OU nenhum (mutuamente exclusivos)
  -- RESTRICT: não permite deletar NF/parcela que tenha pagamento vinculado
  -- (use status='cancelada' em vez de deletar, pra preservar histórico financeiro)
  nota_id uuid,
  parcela_acordo_id uuid, -- FK adicionada depois (acordo_parcelas é criada abaixo)

  data_pagamento date not null default current_date,
  valor numeric(14,2) not null check (valor > 0),
  forma text check (forma in ('boleto', 'ted', 'pix', 'dinheiro', 'cheque', 'deposito', 'outro')),

  -- Categoria do pagamento (pra relatórios)
  origem text not null default 'avulso' check (origem in ('nf', 'acordo', 'avulso')),

  observacao text,
  comprovante_url text,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid references profiles(id),

  -- FKs compostas (multi-tenant + mesma obra)
  -- RESTRICT em obra: pagamentos são fatos financeiros, nunca deletados por cascata
  constraint pagamentos_obra_fk
    foreign key (obra_id, empresa_id) references obras(id, empresa_id) on delete restrict,
  constraint pagamentos_nota_fk
    foreign key (nota_id, empresa_id, obra_id) references notas_fiscais(id, empresa_id, obra_id) on delete restrict,

  -- Vínculo consistente por origem
  constraint pagamento_vinculo_consistente check (
    (origem = 'nf' and nota_id is not null and parcela_acordo_id is null) or
    (origem = 'acordo' and parcela_acordo_id is not null and nota_id is null) or
    (origem = 'avulso' and nota_id is null and parcela_acordo_id is null)
  ),

  unique (id, empresa_id)
);

create index idx_pagamentos_empresa on pagamentos(empresa_id);
create index idx_pagamentos_obra on pagamentos(obra_id);
create index idx_pagamentos_nota on pagamentos(nota_id);
create index idx_pagamentos_parcela on pagamentos(parcela_acordo_id);
create index idx_pagamentos_origem on pagamentos(origem);
create index idx_pagamentos_data on pagamentos(data_pagamento desc);

-- ============================================================
-- 10. ACORDOS DE PAGAMENTO (sem NF)
-- ============================================================
-- ACORDO = agrupador de combinações com o cliente sobre um mesmo assunto.
-- Ex: "Sinal outubro" agrupa as 3 combinações de pagamento que fizemos
-- com o cliente referentes ao sinal daquele mês.
--
-- Cada combinação individual ("te pago 5k dia X") é uma PARCELA.
-- Parcelas vão sendo adicionadas ao acordo conforme as conversas com
-- o cliente evoluem — não precisa saber o valor total antecipadamente.
--
-- Vínculo XOR opcional (contrato OU proposta OU nenhum).
-- Pode ser convertido em NF depois (caso raro).
-- ============================================================

create table acordos_pagamento (
  id uuid primary key default uuid_generate_v4(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  obra_id uuid not null,

  -- Vínculo XOR (opcional)
  contrato_id uuid,
  proposta_id uuid,

  -- Identificação do acordo (o "assunto")
  descricao text not null,                     -- ex: "Sinal outubro - EF Empreendimentos"
  motivo text check (motivo in ('sinal', 'adiantamento_material', 'sem_nf_cliente',
                                 'aditivo_informal', 'emergencial', 'outro')),
  periodo_ref text,                            -- ex: "Outubro/2025" (livre, pra agrupar)

  data_abertura date not null default current_date,
  data_encerramento date,                      -- quando fechou (quitado/cancelado/convertido)

  status text not null default 'aberto' check (status in ('aberto', 'quitado', 'cancelado', 'convertido_nf')),

  -- Se foi convertido em NF depois (raro, mas pode acontecer)
  nf_convertida_id uuid,

  observacao text,
  anexos jsonb default '[]'::jsonb,            -- anexos do CONJUNTO (whatsapp, documento assinado)

  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid references profiles(id),

  -- FKs compostas (multi-tenant + mesma obra)
  -- RESTRICT em obra: acordos representam combinações financeiras, preservar
  constraint acordo_obra_fk
    foreign key (obra_id, empresa_id) references obras(id, empresa_id) on delete restrict,
  constraint acordo_contrato_fk
    foreign key (contrato_id, empresa_id, obra_id) references contratos(id, empresa_id, obra_id) on delete set null (contrato_id),
  constraint acordo_proposta_fk
    foreign key (proposta_id, empresa_id, obra_id) references propostas(id, empresa_id, obra_id) on delete set null (proposta_id),
  constraint acordo_nf_convertida_fk
    foreign key (nf_convertida_id, empresa_id, obra_id) references notas_fiscais(id, empresa_id, obra_id) on delete set null (nf_convertida_id),

  -- XOR: vínculo mutuamente exclusivo
  constraint acordo_vinculo_xor check (
    (proposta_id is null) or (contrato_id is null)
  ),

  unique (id, empresa_id),
  unique (id, empresa_id, obra_id)
);

create index idx_acordos_empresa on acordos_pagamento(empresa_id);
create index idx_acordos_obra on acordos_pagamento(obra_id);
create index idx_acordos_contrato on acordos_pagamento(contrato_id);
create index idx_acordos_proposta on acordos_pagamento(proposta_id);
create index idx_acordos_status on acordos_pagamento(status);
create index idx_acordos_motivo on acordos_pagamento(motivo);
create index idx_acordos_nf_convertida on acordos_pagamento(nf_convertida_id);

-- ============================================================
-- 11. PARCELAS DO ACORDO (cada combinação individual com o cliente)
-- ============================================================
-- Cada linha = uma combinação pontual: "te pago 5k dia X".
-- Vão sendo adicionadas conforme cliente vai combinando novos pagamentos.
-- O "valor total do acordo" é calculado (soma das parcelas).
-- ============================================================

create table acordo_parcelas (
  id uuid primary key default uuid_generate_v4(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  acordo_id uuid not null,

  -- obra_id desnormalizado (sincronizado com acordos_pagamento.obra_id via trigger)
  -- Permite que pagamentos → parcela seja vinculada à MESMA obra
  obra_id uuid not null,

  -- Numeração sequencial dentro do acordo
  numero_parcela integer not null check (numero_parcela > 0),

  -- Data combinada com o cliente (quando disse que pagaria)
  data_vencimento date not null,

  -- Valor combinado pra esta parcela
  valor_previsto numeric(14,2) not null check (valor_previsto > 0),

  -- Status derivado automaticamente via trigger a partir de pagamentos
  -- ('paga' quando soma de pagamentos vinculados >= valor_previsto)
  status text not null default 'pendente' check (status in ('pendente', 'paga', 'parcial', 'atrasada', 'cancelada')),

  -- Observação específica desta combinação (não da entrada de dinheiro)
  observacao text,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique (acordo_id, numero_parcela),

  -- FK composta: acordo pai precisa ser da mesma empresa E mesma obra
  -- (garante que obra_id da parcela bate com obra_id do acordo)
  constraint parcela_acordo_fk
    foreign key (acordo_id, empresa_id, obra_id) references acordos_pagamento(id, empresa_id, obra_id) on delete cascade,

  unique (id, empresa_id),
  unique (id, empresa_id, obra_id)
);

create index idx_parcelas_empresa on acordo_parcelas(empresa_id);
create index idx_parcelas_acordo on acordo_parcelas(acordo_id);
create index idx_parcelas_obra on acordo_parcelas(obra_id);
create index idx_parcelas_status on acordo_parcelas(status);
create index idx_parcelas_vencimento on acordo_parcelas(data_vencimento);

-- Agora que acordo_parcelas existe, adicionar FK composta em pagamentos
-- RESTRICT: não permite deletar parcela que tenha pagamento vinculado
-- Inclui obra_id para garantir que pagamento e parcela são da mesma obra
alter table pagamentos
  add constraint pagamentos_parcela_fk
  foreign key (parcela_acordo_id, empresa_id, obra_id)
  references acordo_parcelas(id, empresa_id, obra_id) on delete restrict;

-- ============================================================
-- 12. FATURAMENTO DIRETO (compras pagas pelo cliente direto ao fornecedor)
-- ============================================================
-- Cliente compra material/insumo direto do fornecedor e desconta da gente.
-- Cada linha representa UM item/parcela de um pedido/documento.
--
-- Três datas distintas:
--   - data_lancamento: quando o FD foi registrado no sistema (auditoria)
--   - data_vencimento: quando o pedido/documento vence pro fornecedor
--   - data_pagamento:  quando o cliente efetivamente pagou o fornecedor
--
-- Flexibilidade de input:
--   - Uso simples: preencher apenas valor + valor_descontar
--   - Uso detalhado: preencher quantidade, preco_unitario, valor (todos input)
--
-- O sistema NÃO força consistência entre quantidade × preço = valor —
-- cliente pode mandar só o valor agregado sem detalhar quantidade.
--
-- Campo calculado:
--   diferenca_favor = valor - valor_descontar
-- ============================================================

create table fd (
  id uuid primary key default uuid_generate_v4(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  obra_id uuid not null,

  -- Identificação do lançamento
  pedido_documento text,                       -- nº do pedido ou documento de referência
  item_parcela text,                           -- qual item/parcela do pedido (ex: "3/5")

  -- Datas
  data_lancamento date not null default current_date,  -- quando foi registrado no sistema
  data_vencimento date,                                 -- quando o pedido/documento vence
  data_pagamento date,                                  -- quando o cliente pagou o fornecedor

  -- Produto/serviço (todos opcionais, preencher conforme detalhamento disponível)
  codigo text,                                 -- código interno do produto/item
  especificacao text,                          -- descrição técnica
  unidade text,                                -- UN, KG, M, M², PÇ, etc
  quantidade numeric(14,4) check (quantidade is null or quantidade >= 0),
  preco_unitario numeric(14,4) check (preco_unitario is null or preco_unitario >= 0),

  -- Fornecedor (quem emitiu a NF pro cliente)
  fornecedor text not null,

  -- Valores de conciliação (ambos input direto)
  valor numeric(14,2) not null default 0 check (valor >= 0),                          -- o que cliente gastou
  valor_descontar numeric(14,2) not null default 0 check (valor_descontar >= 0),      -- o que aceitamos descontar

  -- Diferença a nosso favor (calculada automaticamente)
  diferenca_favor numeric(14,2) generated always as (valor - valor_descontar) stored,

  -- Justificativa e observações
  justificativa text,                          -- por que aceitamos desconto menor
  observacao text,

  -- Evidências (NFs fornecedor, planilhas cliente, e-mails)
  evidencias jsonb default '[]'::jsonb,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid references profiles(id),

  -- FK composta (multi-tenant): obra vinculada precisa ser da mesma empresa
  -- RESTRICT: FD é histórico fiscal de conciliação, preservar
  constraint fd_obra_fk
    foreign key (obra_id, empresa_id) references obras(id, empresa_id) on delete restrict
);

create index idx_fd_empresa on fd(empresa_id);
create index idx_fd_obra on fd(obra_id);
create index idx_fd_data_lancamento on fd(data_lancamento desc);
create index idx_fd_data_vencimento on fd(data_vencimento);
create index idx_fd_data_pagamento on fd(data_pagamento);
create index idx_fd_pedido on fd(pedido_documento);
create index idx_fd_fornecedor on fd(fornecedor);

-- ============================================================
-- 13. TRIGGERS: updated_at automático
-- ============================================================

create or replace function update_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Aplicar em todas as tabelas com updated_at
create trigger trg_empresas_updated before update on empresas
  for each row execute function update_updated_at();
create trigger trg_profiles_updated before update on profiles
  for each row execute function update_updated_at();
create trigger trg_orcamentos_updated before update on orcamentos
  for each row execute function update_updated_at();
create trigger trg_obras_updated before update on obras
  for each row execute function update_updated_at();
create trigger trg_propostas_updated before update on propostas
  for each row execute function update_updated_at();
create trigger trg_contratos_updated before update on contratos
  for each row execute function update_updated_at();
create trigger trg_itens_updated before update on itens
  for each row execute function update_updated_at();
create trigger trg_execucao_updated before update on execucao
  for each row execute function update_updated_at();
create trigger trg_notas_updated before update on notas_fiscais
  for each row execute function update_updated_at();
create trigger trg_pagamentos_updated before update on pagamentos
  for each row execute function update_updated_at();
create trigger trg_acordos_updated before update on acordos_pagamento
  for each row execute function update_updated_at();
create trigger trg_parcelas_updated before update on acordo_parcelas
  for each row execute function update_updated_at();
create trigger trg_fd_updated before update on fd
  for each row execute function update_updated_at();

-- ============================================================
-- 14. DADOS INICIAIS: sua empresa
-- ============================================================
-- IMPORTANTE: substitua os valores abaixo pelos dados reais da sua empresa
-- antes de rodar. Você vai precisar do ID dessa empresa no próximo passo.

insert into empresas (nome, cnpj) values
  ('SUA EMPRESA AQUI LTDA', '00.000.000/0001-00');

-- ============================================================
-- 14a. TRIGGERS: execução (sincronização de qtd_total e datas)
-- ============================================================
-- (a) Sincronizar quantidade_total da execução com itens.quantidade
--     - Ao INSERT em execução, copia itens.quantidade pra quantidade_total
--     - Ao UPDATE em itens.quantidade, atualiza execucao.quantidade_total
--
-- (b) Preencher datas automáticas quando qtd de uma etapa muda:
--     - data_inicio: primeira vez que a qtd sai de 0
--     - data_atualizacao: toda vez que a qtd muda
--     - data_fim: quando a qtd alcança quantidade_total
--
-- O usuário só atualiza fab_qtd, ent_qtd, inst_qtd, med_qtd.
-- O banco cuida do resto (datas + status).
-- ============================================================

-- (a1) Trigger antes do INSERT em execucao: copia qtd do item
create or replace function execucao_set_quantidade_total()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  select quantidade into new.quantidade_total
  from itens where id = new.item_id;

  if new.quantidade_total is null then
    new.quantidade_total := 0;
  end if;

  return new;
end;
$$;

create trigger trg_execucao_set_qtd_total
  before insert on execucao
  for each row execute function execucao_set_quantidade_total();

-- (a2) Trigger ao mudar itens.quantidade: sincroniza execucao.quantidade_total
create or replace function itens_sincroniza_execucao_qtd()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (new.quantidade is distinct from old.quantidade) then
    update execucao
    set quantidade_total = coalesce(new.quantidade, 0)
    where item_id = new.id;
  end if;
  return new;
end;
$$;

create trigger trg_item_sincroniza_execucao
  after update of quantidade on itens
  for each row execute function itens_sincroniza_execucao_qtd();

-- (b) Trigger BEFORE UPDATE em execucao: preenche datas de cada etapa
-- Usa BEFORE pra setar os campos no NEW antes de gravar (sem gerar update extra)
create or replace function execucao_preenche_datas()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- FABRICAÇÃO
  if (new.fab_qtd is distinct from old.fab_qtd) then
    new.fab_data_atualizacao := current_date;
    if old.fab_qtd = 0 and new.fab_qtd > 0 then
      new.fab_data_inicio := coalesce(old.fab_data_inicio, current_date);
    end if;
    if new.fab_qtd >= new.quantidade_total and new.quantidade_total > 0 then
      new.fab_data_fim := coalesce(old.fab_data_fim, current_date);
    elsif new.fab_qtd < new.quantidade_total then
      new.fab_data_fim := null;  -- voltou pra andamento
    end if;
  end if;

  -- ENTREGA
  if (new.ent_qtd is distinct from old.ent_qtd) then
    new.ent_data_atualizacao := current_date;
    if old.ent_qtd = 0 and new.ent_qtd > 0 then
      new.ent_data_inicio := coalesce(old.ent_data_inicio, current_date);
    end if;
    if new.ent_qtd >= new.quantidade_total and new.quantidade_total > 0 then
      new.ent_data_fim := coalesce(old.ent_data_fim, current_date);
    elsif new.ent_qtd < new.quantidade_total then
      new.ent_data_fim := null;
    end if;
  end if;

  -- INSTALAÇÃO
  if (new.inst_qtd is distinct from old.inst_qtd) then
    new.inst_data_atualizacao := current_date;
    if old.inst_qtd = 0 and new.inst_qtd > 0 then
      new.inst_data_inicio := coalesce(old.inst_data_inicio, current_date);
    end if;
    if new.inst_qtd >= new.quantidade_total and new.quantidade_total > 0 then
      new.inst_data_fim := coalesce(old.inst_data_fim, current_date);
    elsif new.inst_qtd < new.quantidade_total then
      new.inst_data_fim := null;
    end if;
  end if;

  -- MEDIÇÃO
  if (new.med_qtd is distinct from old.med_qtd) then
    new.med_data_atualizacao := current_date;
    if old.med_qtd = 0 and new.med_qtd > 0 then
      new.med_data_inicio := coalesce(old.med_data_inicio, current_date);
    end if;
    if new.med_qtd >= new.quantidade_total and new.quantidade_total > 0 then
      new.med_data_fim := coalesce(old.med_data_fim, current_date);
    elsif new.med_qtd < new.quantidade_total then
      new.med_data_fim := null;
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_execucao_preenche_datas
  before update of fab_qtd, ent_qtd, inst_qtd, med_qtd, quantidade_total on execucao
  for each row execute function execucao_preenche_datas();

-- ============================================================
-- 15. TRIGGERS: cascata de status — pagamentos → parcelas → acordos
-- ============================================================
-- Lógica:
-- (a) Quando um pagamento muda, recalcula status da parcela vinculada
--     somando todos os pagamentos da parcela.
-- (b) Quando uma parcela muda, recalcula status do acordo pai
--     (quitado quando todas pagas).
--
-- Tabela `pagamentos` é a ÚNICA fonte da verdade pra entrada de dinheiro.
-- Parcelas e acordos têm seus status derivados disso.
-- ============================================================

-- (a) Trigger em pagamentos → atualiza status da parcela vinculada
create or replace function atualizar_status_parcela()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parcela_id uuid;
  v_nota_id uuid;
begin
  -- Identifica parcela e NF afetadas (antes/depois da mudança)
  if (tg_op = 'DELETE') then
    v_parcela_id := old.parcela_acordo_id;
    v_nota_id := old.nota_id;
  else
    v_parcela_id := new.parcela_acordo_id;
    v_nota_id := new.nota_id;

    -- Se UPDATE mudou a parcela ou NF vinculada, atualiza as antigas também
    if (tg_op = 'UPDATE') then
      if (old.parcela_acordo_id is distinct from new.parcela_acordo_id
          and old.parcela_acordo_id is not null) then
        perform atualizar_status_parcela_by_id(old.parcela_acordo_id);
      end if;
      if (old.nota_id is distinct from new.nota_id
          and old.nota_id is not null) then
        perform atualizar_status_nf_by_id(old.nota_id);
      end if;
    end if;
  end if;

  -- Recalcula status da parcela (se o pagamento era de acordo)
  if v_parcela_id is not null then
    perform atualizar_status_parcela_by_id(v_parcela_id);
  end if;

  -- Recalcula status da NF (se o pagamento era de NF)
  if v_nota_id is not null then
    perform atualizar_status_nf_by_id(v_nota_id);
  end if;

  return coalesce(new, old);
end;
$$;

-- Função auxiliar: recalcula status de UMA parcela específica
create or replace function atualizar_status_parcela_by_id(p_parcela_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_valor_previsto numeric;
  v_total_pago numeric;
  v_data_vencimento date;
  v_status_atual text;
  v_novo_status text;
begin
  select valor_previsto, data_vencimento, status
  into v_valor_previsto, v_data_vencimento, v_status_atual
  from acordo_parcelas where id = p_parcela_id;

  if v_status_atual = 'cancelada' then
    return; -- não mexe em parcelas canceladas
  end if;

  -- Soma pagamentos dessa parcela
  select coalesce(sum(valor), 0) into v_total_pago
  from pagamentos where parcela_acordo_id = p_parcela_id;

  -- Determina novo status
  if v_total_pago >= v_valor_previsto and v_valor_previsto > 0 then
    v_novo_status := 'paga';
  elsif v_total_pago > 0 then
    v_novo_status := 'parcial';
  elsif v_data_vencimento < current_date then
    v_novo_status := 'atrasada';
  else
    v_novo_status := 'pendente';
  end if;

  update acordo_parcelas
  set status = v_novo_status
  where id = p_parcela_id
    and status != v_novo_status;
end;
$$;

-- Função auxiliar: recalcula status de UMA nota fiscal específica
-- Cancelada é status terminal → NUNCA sobrescrito pelo trigger
-- (se um pagamento chega em NF cancelada, é uma inconsistência de processo
--  que precisa ser tratada manualmente — estorno, reembolso, etc)
create or replace function atualizar_status_nf_by_id(p_nota_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_valor_total numeric;
  v_total_pago numeric;
  v_status_atual text;
  v_novo_status text;
begin
  select valor_total, status
  into v_valor_total, v_status_atual
  from notas_fiscais where id = p_nota_id;

  -- NFs canceladas são imutáveis
  if v_status_atual = 'cancelada' then
    return;
  end if;

  -- Soma pagamentos dessa NF
  select coalesce(sum(valor), 0) into v_total_pago
  from pagamentos where nota_id = p_nota_id;

  -- Determina novo status
  if v_total_pago >= v_valor_total and v_valor_total > 0 then
    v_novo_status := 'paga';
  elsif v_total_pago > 0 then
    v_novo_status := 'parcial';
  else
    v_novo_status := 'emitida';
  end if;

  update notas_fiscais
  set status = v_novo_status
  where id = p_nota_id
    and status != v_novo_status;
end;
$$;

create trigger trg_pagamento_atualiza_parcela
  after insert or update or delete on pagamentos
  for each row execute function atualizar_status_parcela();

-- Trigger em notas_fiscais: recalcula status quando valor_total muda
-- (ex: correção de valor após emissão)
create or replace function atualizar_status_nf_on_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (new.valor_total is distinct from old.valor_total) then
    perform atualizar_status_nf_by_id(new.id);
  end if;
  return new;
end;
$$;

create trigger trg_nf_valor_atualiza_status
  after update on notas_fiscais
  for each row execute function atualizar_status_nf_on_update();

-- Trigger em acordo_parcelas: recalcula status quando valor_previsto ou
-- data_vencimento mudam diretamente (sem passar por pagamento).
-- UPDATE OF filtra as colunas, WHEN evita reentrada se só mudou o status.
create or replace function atualizar_status_parcela_on_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform atualizar_status_parcela_by_id(new.id);
  return new;
end;
$$;

create trigger trg_parcela_recalcula_status
  after update of valor_previsto, data_vencimento on acordo_parcelas
  for each row
  when (old.valor_previsto is distinct from new.valor_previsto
     or old.data_vencimento is distinct from new.data_vencimento)
  execute function atualizar_status_parcela_on_update();

-- (b) Trigger em acordo_parcelas → atualiza status do acordo pai
-- Só transita entre 'aberto' ↔ 'quitado'. Status terminais ('cancelado',
-- 'convertido_nf') são preservados porque o WHERE filtra por status origem.
create or replace function atualizar_status_acordo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_acordo_id uuid;
  v_total_parcelas integer;
  v_pagas integer;
  v_canceladas integer;
begin
  if (tg_op = 'DELETE') then
    v_acordo_id := old.acordo_id;
  else
    v_acordo_id := new.acordo_id;
  end if;

  -- Conta parcelas por status
  select
    count(*),
    count(*) filter (where status = 'paga'),
    count(*) filter (where status = 'cancelada')
  into v_total_parcelas, v_pagas, v_canceladas
  from acordo_parcelas where acordo_id = v_acordo_id;

  -- Todas parcelas válidas (não canceladas) estão pagas → acordo quitado
  if v_total_parcelas > 0 and v_pagas + v_canceladas = v_total_parcelas and v_pagas > 0 then
    update acordos_pagamento
    set status = 'quitado',
        data_encerramento = coalesce(data_encerramento, current_date)
    where id = v_acordo_id and status = 'aberto';
  else
    -- Caso contrário, garante que está 'aberto'
    update acordos_pagamento
    set status = 'aberto',
        data_encerramento = null
    where id = v_acordo_id and status = 'quitado';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger trg_parcela_atualiza_acordo
  after insert or update or delete on acordo_parcelas
  for each row execute function atualizar_status_acordo();

-- ============================================================
-- FUNÇÃO: marcar parcelas atrasadas (manutenção diária)
-- ============================================================
-- Chamada diariamente (via Edge Function ou ao abrir tela financeira):
-- marca como 'atrasada' qualquer parcela 'pendente' com vencimento passado.
-- ============================================================

create or replace function atualizar_parcelas_atrasadas()
returns integer as $$
declare
  v_count integer;
begin
  update acordo_parcelas
  set status = 'atrasada'
  where status = 'pendente'
    and data_vencimento < current_date;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$ language plpgsql;

-- ============================================================
-- 16. VIEW: receitas consolidadas da obra
-- ============================================================
-- Agrega todo o fluxo de recebíveis e recebidos da obra.
--
-- SEMÂNTICA DAS MÉTRICAS:
--   total_nfs_emitidas         → soma das NFs não canceladas
--   total_nfs_recebido         → soma dos pagamentos com origem='nf'
--   total_acordos              → soma das parcelas não canceladas de acordos ATIVOS
--                                (acordos 'cancelado' e 'convertido_nf' são excluídos)
--   total_acordos_recebido     → pagamentos com origem='acordo' de acordos ATIVOS
--                                (exclui pagamentos de acordos convertidos em NF)
--   total_avulso_recebido      → soma dos pagamentos com origem='avulso'
--   total_a_receber            → NFs emitidas + parcelas de acordos ativos
--   total_recebido             → pagamentos vigentes (NF + avulso + acordo ATIVO)
--                                exclui pagamentos de acordos convertidos em NF
--   total_acordos_convertidos_arquivado
--                              → pagamentos antigos de acordos convertidos em NF
--                                (histórico preservado, mas fora do fluxo vigente)
--   saldo_pendente             → total_a_receber - total_recebido
--
-- CONVERSÃO ACORDO → NF:
-- Quando acordo.status = 'convertido_nf':
--   1. O acordo sai de 'total_acordos' (não é mais a receber via acordo)
--   2. A NF de saldo emitida entra em 'total_nfs_emitidas' com valor = saldo restante
--   3. Pagamentos ANTIGOS do acordo são "arquivados": saem de 'total_recebido',
--      entram em 'total_acordos_convertidos_arquivado' (rastreável para auditoria)
--   4. Novos pagamentos contra a NF entram em 'total_nfs_recebido' normalmente
-- Resultado: saldo_pendente reflete corretamente apenas o que falta pagar na NF.
-- ============================================================

create or replace view receitas_obra with (security_invoker = true) as
select
  o.id as obra_id,
  o.empresa_id,
  o.codigo_obra,
  o.nome as obra_nome,

  -- NFs emitidas (não canceladas)
  coalesce((select sum(valor_total) from notas_fiscais
            where obra_id = o.id and status != 'cancelada'), 0) as total_nfs_emitidas,
  coalesce((select sum(p.valor) from pagamentos p
            where p.obra_id = o.id and p.origem = 'nf'), 0) as total_nfs_recebido,

  -- Acordos — soma do VALOR PREVISTO das parcelas não canceladas (total a receber via acordos)
  coalesce((
    select sum(ap.valor_previsto)
    from acordo_parcelas ap
    join acordos_pagamento a on a.id = ap.acordo_id
    where a.obra_id = o.id
      and a.status not in ('cancelado', 'convertido_nf')
      and ap.status != 'cancelada'
  ), 0) as total_acordos,

  -- Recebido de acordos vigentes (exclui pagamentos de acordos convertidos em NF)
  coalesce((
    select sum(p.valor)
    from pagamentos p
    join acordo_parcelas ap on ap.id = p.parcela_acordo_id
    join acordos_pagamento a on a.id = ap.acordo_id
    where p.obra_id = o.id
      and p.origem = 'acordo'
      and a.status not in ('cancelado', 'convertido_nf')
  ), 0) as total_acordos_recebido,

  -- Pagamentos avulsos
  coalesce((select sum(p.valor) from pagamentos p
            where p.obra_id = o.id and p.origem = 'avulso'), 0) as total_avulso_recebido,

  -- Total a receber = NFs + parcelas de acordos (não canceladas)
  coalesce((select sum(valor_total) from notas_fiscais
            where obra_id = o.id and status != 'cancelada'), 0)
  + coalesce((
      select sum(ap.valor_previsto)
      from acordo_parcelas ap
      join acordos_pagamento a on a.id = ap.acordo_id
      where a.obra_id = o.id
        and a.status not in ('cancelado', 'convertido_nf')
        and ap.status != 'cancelada'
    ), 0) as total_a_receber,

  -- Pagamentos de acordos que foram convertidos em NF (histórico arquivado)
  -- Não entram em total_recebido, mas ficam rastreáveis pra auditoria
  coalesce((
    select sum(p.valor)
    from pagamentos p
    join acordo_parcelas ap on ap.id = p.parcela_acordo_id
    join acordos_pagamento a on a.id = ap.acordo_id
    where p.obra_id = o.id
      and p.origem = 'acordo'
      and a.status = 'convertido_nf'
  ), 0) as total_acordos_convertidos_arquivado,

  -- Total recebido = pagamentos de NF + avulsos + pagamentos de acordos NÃO convertidos em NF
  -- (pagamentos de acordos convertidos em NF ficam "arquivados" - a NF de saldo
  --  representa o que ainda falta, os pagamentos antigos não entram no fluxo vigente)
  coalesce((
    select sum(p.valor)
    from pagamentos p
    left join acordo_parcelas ap on ap.id = p.parcela_acordo_id
    left join acordos_pagamento a on a.id = ap.acordo_id
    where p.obra_id = o.id
      and (p.origem != 'acordo' or a.status != 'convertido_nf')
  ), 0) as total_recebido,

  -- Saldo pendente = a receber - recebido (ambos já excluem acordos convertidos)
  (
    coalesce((select sum(valor_total) from notas_fiscais
              where obra_id = o.id and status != 'cancelada'), 0)
    + coalesce((
        select sum(ap.valor_previsto)
        from acordo_parcelas ap
        join acordos_pagamento a on a.id = ap.acordo_id
        where a.obra_id = o.id
          and a.status not in ('cancelado', 'convertido_nf')
          and ap.status != 'cancelada'
      ), 0)
  ) - coalesce((
        select sum(p.valor)
        from pagamentos p
        left join acordo_parcelas ap on ap.id = p.parcela_acordo_id
        left join acordos_pagamento a on a.id = ap.acordo_id
        where p.obra_id = o.id
          and (p.origem != 'acordo' or a.status != 'convertido_nf')
      ), 0)
  as saldo_pendente

from obras o;

grant select on receitas_obra to authenticated;

-- ============================================================
-- 17. FUNÇÕES HELPER para testes e uso cotidiano
-- ============================================================

-- Retorna empresa_id do usuário logado (usado em RLS e queries)
-- SECURITY DEFINER porque precisa ler profiles mesmo quando chamada
-- dentro de policies que filtram profiles (evita recursão)
create or replace function current_empresa_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select empresa_id from profiles where id = auth.uid() limit 1;
$$;

-- Retorna perfil do usuário logado
create or replace function current_perfil()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select perfil from profiles where id = auth.uid() limit 1;
$$;

-- Helper: verifica se usuário tem um dos perfis
create or replace function has_perfil(perfis text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (select perfil from profiles where id = auth.uid()) = any(perfis);
$$;

-- ============================================================
-- 18. VALORES CALCULADOS DA OBRA
-- ============================================================
-- Lógica de cálculo do "valor vigente" da obra:
--
-- REGRA: soma todos os contratos (exceto rescindidos) +
--        propostas aprovadas QUE NÃO ORIGINARAM contrato algum
--
-- Se obra é importada/legada (sem proposta/contrato), usa fallback
-- nos campos da própria obra (valor_final, pct_*).
-- ============================================================

-- Função que retorna todos os valores calculados de uma obra
-- Retorna UMA linha com: valor_total, desconto, valor_final, pct_*, fonte
-- SECURITY INVOKER: respeita RLS — usuário só vê dados da própria empresa
create or replace function calcular_valores_obra(p_obra_id uuid)
returns table (
  valor_total numeric,
  desconto numeric,
  valor_final numeric,
  pct_sinal numeric,
  pct_fd numeric,
  pct_entrega_material numeric,
  pct_medicao_instalacao numeric,
  condicoes_pagamento text,
  fonte text  -- 'contratos+propostas', 'propostas', 'legado'
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tem_contrato boolean;
  v_tem_proposta_aprovada boolean;
begin
  -- Verifica se existem contratos não rescindidos
  select exists(
    select 1 from contratos
    where obra_id = p_obra_id and status != 'rescindido'
  ) into v_tem_contrato;

  -- Verifica se existem propostas aprovadas sem contrato origem
  select exists(
    select 1 from propostas p
    where p.obra_id = p_obra_id
      and p.status = 'aprovada'
      and not exists (
        select 1 from contratos c
        where c.proposta_origem_id = p.id and c.status != 'rescindido'
      )
  ) into v_tem_proposta_aprovada;

  -- CASO 1: tem contrato e/ou proposta aprovada → calcula dinamicamente
  if v_tem_contrato or v_tem_proposta_aprovada then
    return query
    with
    -- Contratos não rescindidos
    c_vigentes as (
      select
        valor_total,
        pct_sinal, pct_fd, pct_entrega_material, pct_medicao_instalacao,
        condicoes_pagamento
      from contratos
      where obra_id = p_obra_id and status != 'rescindido'
    ),
    -- Propostas aprovadas sem contrato origem
    p_aprovadas_sem_contrato as (
      select
        p.valor_total,                                       -- valor bruto (pré-desconto)
        p.desconto,
        p.pct_sinal, p.pct_fd, p.pct_entrega_material, p.pct_medicao_instalacao,
        p.condicoes_pagamento
      from propostas p
      where p.obra_id = p_obra_id
        and p.status = 'aprovada'
        and not exists (
          select 1 from contratos c
          where c.proposta_origem_id = p.id and c.status != 'rescindido'
        )
    ),
    -- União dos dois (contratos + propostas aprovadas)
    -- Contratos não têm conceito de desconto separado, então desconto=0
    todos as (
      select valor_total, 0::numeric as desconto, pct_sinal, pct_fd,
             pct_entrega_material, pct_medicao_instalacao, condicoes_pagamento
      from c_vigentes
      union all
      select valor_total, desconto, pct_sinal, pct_fd,
             pct_entrega_material, pct_medicao_instalacao, condicoes_pagamento
      from p_aprovadas_sem_contrato
    )
    select
      coalesce(sum(t.valor_total), 0)::numeric as valor_total,                         -- soma bruta
      coalesce(sum(t.desconto), 0)::numeric as desconto,                               -- desconto consolidado
      coalesce(sum(t.valor_total) - sum(t.desconto), 0)::numeric as valor_final,       -- líquido
      -- Percentuais: média ponderada pelo valor líquido de cada linha
      -- (valor_total - desconto) reflete o valor efetivo sobre o qual os pct são aplicados
      case when sum(t.valor_total - t.desconto) > 0
        then sum(t.pct_sinal * (t.valor_total - t.desconto)) / sum(t.valor_total - t.desconto)
        else 0 end::numeric as pct_sinal,
      case when sum(t.valor_total - t.desconto) > 0
        then sum(t.pct_fd * (t.valor_total - t.desconto)) / sum(t.valor_total - t.desconto)
        else 0 end::numeric as pct_fd,
      case when sum(t.valor_total - t.desconto) > 0
        then sum(t.pct_entrega_material * (t.valor_total - t.desconto)) / sum(t.valor_total - t.desconto)
        else 0 end::numeric as pct_entrega_material,
      case when sum(t.valor_total - t.desconto) > 0
        then sum(t.pct_medicao_instalacao * (t.valor_total - t.desconto)) / sum(t.valor_total - t.desconto)
        else 0 end::numeric as pct_medicao_instalacao,
      -- Concatena as condições livres
      string_agg(nullif(t.condicoes_pagamento, ''), E'\n---\n') as condicoes_pagamento,
      case
        when v_tem_contrato and v_tem_proposta_aprovada then 'contratos+propostas'
        when v_tem_contrato then 'contratos'
        else 'propostas'
      end as fonte
    from todos t;
  else
    -- CASO 2: obra sem propostas/contratos → usa valores legados
    return query
    select
      o.valor_total,
      o.desconto,
      o.valor_final,
      o.pct_sinal,
      o.pct_fd,
      o.pct_entrega_material,
      o.pct_medicao_instalacao,
      o.forma_pagamento as condicoes_pagamento,
      'legado'::text as fonte
    from obras o
    where o.id = p_obra_id;
  end if;
end;
$$;

-- VIEW que junta obra + seus valores calculados
-- Use esta view pra listar obras no frontend
create or replace view obras_com_valores with (security_invoker = true) as
select
  o.*,
  calc.valor_total as valor_total_calculado,
  calc.desconto as desconto_calculado,
  calc.valor_final as valor_final_calculado,
  calc.pct_sinal as pct_sinal_calculado,
  calc.pct_fd as pct_fd_calculado,
  calc.pct_entrega_material as pct_entrega_material_calculado,
  calc.pct_medicao_instalacao as pct_medicao_instalacao_calculado,
  calc.condicoes_pagamento as condicoes_pagamento_calculado,
  calc.fonte as fonte_valores
from obras o,
  lateral calcular_valores_obra(o.id) calc;

-- Permitir acesso à view via RLS (security_invoker aplica as policies de obras)
grant select on obras_com_valores to authenticated;

-- ============================================================
-- 19. STATUS CONSOLIDADO DOS ITENS
-- ============================================================
-- Calcula o "status atual" de cada item baseado nas 4 etapas de execução.
-- O frontend consulta esta view em vez da tabela itens diretamente.
-- ============================================================

create or replace view itens_com_status with (security_invoker = true) as
select
  i.*,
  -- Status individual de cada etapa (vem da execucao ou 'pendente' se não tem)
  coalesce(e.fab_status, 'pendente') as status_fabricacao,
  coalesce(e.ent_status, 'pendente') as status_entrega,
  coalesce(e.inst_status, 'pendente') as status_instalacao,
  coalesce(e.med_status, 'pendente') as status_medicao,

  -- Quantidades parciais por etapa (NOVO)
  coalesce(e.fab_qtd, 0) as qtd_fabricada,
  coalesce(e.ent_qtd, 0) as qtd_entregue,
  coalesce(e.inst_qtd, 0) as qtd_instalada,
  coalesce(e.med_qtd, 0) as qtd_medida,

  -- Datas: data da última atualização e data de conclusão da etapa
  e.fab_data_atualizacao as data_ultima_fabricacao,
  e.fab_data_fim as data_fabricacao_concluida,
  e.ent_data_atualizacao as data_ultima_entrega,
  e.ent_data_fim as data_entrega_concluida,
  e.inst_data_atualizacao as data_ultima_instalacao,
  e.inst_data_fim as data_instalacao_concluida,
  e.med_data_atualizacao as data_ultima_medicao,
  e.med_data_fim as data_medicao_concluida,

  -- Responsáveis
  e.fab_responsavel as responsavel_fabricacao,
  e.ent_responsavel as responsavel_entrega,
  e.inst_responsavel as responsavel_instalacao,
  e.med_responsavel as responsavel_medicao,

  -- Status atual (o mais avançado em concluído ou em andamento)
  case
    when e.med_status = 'concluido' then 'medido'
    when e.med_status = 'andamento' then 'medindo'
    when e.inst_status = 'concluido' then 'aguardando_medicao'
    when e.inst_status = 'andamento' then 'instalando'
    when e.ent_status = 'concluido' then 'aguardando_instalacao'
    when e.ent_status = 'andamento' then 'entregando'
    when e.fab_status = 'concluido' then 'aguardando_entrega'
    when e.fab_status = 'andamento' then 'fabricando'
    else 'aguardando_fabricacao'
  end as status_atual,

  -- Etapa atual (útil pra filtros e relatórios)
  case
    when e.med_status = 'concluido' then 'finalizado'
    when e.inst_status = 'concluido' or e.med_status in ('andamento') then 'medicao'
    when e.ent_status = 'concluido' or e.inst_status in ('andamento') then 'instalacao'
    when e.fab_status = 'concluido' or e.ent_status in ('andamento') then 'entrega'
    else 'fabricacao'
  end as etapa_atual,

  -- Progresso percentual REAL baseado em quantidade (granular, 0-100%)
  -- Cada etapa vale 25% e contribui proporcionalmente: (qtd_etapa / total) × 25
  -- Ex: item 100un, fab=100, ent=80, inst=50, med=0 → 25 + 20 + 12.5 + 0 = 57.5%
  case
    when coalesce(e.quantidade_total, 0) = 0 then 0
    else round((
      coalesce(e.fab_qtd, 0) / e.quantidade_total * 25 +
      coalesce(e.ent_qtd, 0) / e.quantidade_total * 25 +
      coalesce(e.inst_qtd, 0) / e.quantidade_total * 25 +
      coalesce(e.med_qtd, 0) / e.quantidade_total * 25
    )::numeric, 2)
  end as progresso_pct,

  -- Progresso "etapas" (0, 25, 50, 75, 100) — útil pra dashboards simples
  (
    case when e.fab_status = 'concluido' then 25 else 0 end +
    case when e.ent_status = 'concluido' then 25 else 0 end +
    case when e.inst_status = 'concluido' then 25 else 0 end +
    case when e.med_status = 'concluido' then 25 else 0 end
  ) as progresso_etapas_pct,

  -- Contador de evidências
  jsonb_array_length(coalesce(e.evidencias, '[]'::jsonb)) as evidencias_count

from itens i
left join execucao e on e.item_id = i.id;

grant select on itens_com_status to authenticated;

-- ============================================================
-- 20. FINANCEIRO CONSOLIDADO DA OBRA
-- ============================================================
-- Agrega faturamento e recebimento no nível da obra (não do item).
-- Notas são por marco/valor, pagamentos podem ser parciais sobre NF.
-- ============================================================

create or replace view obras_financeiro with (security_invoker = true) as
select
  o.id as obra_id,
  o.empresa_id,
  o.codigo_obra,
  o.nome,

  -- Faturamento (soma das NFs não canceladas)
  coalesce((
    select sum(valor_total)
    from notas_fiscais nf
    where nf.obra_id = o.id and nf.status != 'cancelada'
  ), 0) as total_faturado,

  -- Acordos (soma das parcelas não canceladas)
  coalesce((
    select sum(ap.valor_previsto)
    from acordo_parcelas ap
    join acordos_pagamento a on a.id = ap.acordo_id
    where a.obra_id = o.id
      and a.status not in ('cancelado', 'convertido_nf')
      and ap.status != 'cancelada'
  ), 0) as total_acordos,

  -- Recebido de acordos vigentes (exclui pagamentos de acordos convertidos em NF)
  coalesce((
    select sum(p.valor)
    from pagamentos p
    join acordo_parcelas ap on ap.id = p.parcela_acordo_id
    join acordos_pagamento a on a.id = ap.acordo_id
    where p.obra_id = o.id
      and p.origem = 'acordo'
      and a.status not in ('cancelado', 'convertido_nf')
  ), 0) as total_acordos_recebido,

  -- Faturamento Direto (descontos do cliente com fornecedores)
  coalesce((
    select sum(valor_descontar)
    from fd
    where fd.obra_id = o.id
  ), 0) as total_fd_aceito,

  coalesce((
    select sum(valor)
    from fd
    where fd.obra_id = o.id
  ), 0) as total_fd_bruto,

  coalesce((
    select sum(diferenca_favor)
    from fd
    where fd.obra_id = o.id
  ), 0) as total_fd_diferenca_favor,

  -- Recebido vigente (exclui pagamentos de acordos convertidos em NF, pra não dupla contar
  -- quando NF de saldo foi emitida — esses pagamentos ficam arquivados no histórico)
  coalesce((
    select sum(p.valor)
    from pagamentos p
    left join acordo_parcelas ap on ap.id = p.parcela_acordo_id
    left join acordos_pagamento a on a.id = ap.acordo_id
    where p.obra_id = o.id
      and (p.origem != 'acordo' or a.status != 'convertido_nf')
  ), 0) as total_recebido_pagamentos,

  -- Contagens
  (select count(*) from notas_fiscais where obra_id = o.id and status != 'cancelada') as qtd_nfs,
  (select count(*) from pagamentos where obra_id = o.id) as qtd_pagamentos,
  (select count(*) from acordos_pagamento where obra_id = o.id and status != 'cancelado') as qtd_acordos,
  (select count(*) from fd where obra_id = o.id) as qtd_fd
from obras o;

grant select on obras_financeiro to authenticated;

-- ============================================================
-- 21. FINANCEIRO CONSOLIDADO POR CONTRATO/PROPOSTA
-- ============================================================
-- Rastreia faturamento e recebimento no nível de contrato e proposta.
-- Responde: "Quanto desse contrato já foi faturado/recebido?"
-- ============================================================

-- Por CONTRATO
create or replace view contratos_financeiro with (security_invoker = true) as
select
  c.*,
  -- Faturamento via NF
  coalesce((
    select sum(valor_total)
    from notas_fiscais nf
    where nf.contrato_id = c.id and nf.status != 'cancelada'
  ), 0) as total_nfs,

  -- Acordos vinculados — soma das parcelas não canceladas
  coalesce((
    select sum(ap.valor_previsto)
    from acordo_parcelas ap
    join acordos_pagamento a on a.id = ap.acordo_id
    where a.contrato_id = c.id
      and a.status not in ('cancelado', 'convertido_nf')
      and ap.status != 'cancelada'
  ), 0) as total_acordos,

  -- Recebido via NFs deste contrato
  coalesce((
    select sum(p.valor)
    from pagamentos p
    join notas_fiscais nf on nf.id = p.nota_id
    where nf.contrato_id = c.id and nf.status != 'cancelada'
  ), 0) as recebido_nfs,

  -- Recebido via parcelas de acordos deste contrato (apenas acordos vigentes)
  -- Exclui acordos convertidos em NF (já representados na NF de saldo)
  coalesce((
    select sum(p.valor)
    from pagamentos p
    join acordo_parcelas ap on ap.id = p.parcela_acordo_id
    join acordos_pagamento a on a.id = ap.acordo_id
    where a.contrato_id = c.id
      and p.origem = 'acordo'
      and a.status not in ('cancelado', 'convertido_nf')
  ), 0) as recebido_acordos,

  -- Saldo a faturar = valor_total do contrato - (nfs + acordos)
  c.valor_total - (
    coalesce((
      select sum(valor_total) from notas_fiscais nf
      where nf.contrato_id = c.id and nf.status != 'cancelada'
    ), 0) +
    coalesce((
      select sum(ap.valor_previsto)
      from acordo_parcelas ap
      join acordos_pagamento a on a.id = ap.acordo_id
      where a.contrato_id = c.id
        and a.status not in ('cancelado', 'convertido_nf')
        and ap.status != 'cancelada'
    ), 0)
  ) as saldo_a_faturar
from contratos c;

grant select on contratos_financeiro to authenticated;

-- Por PROPOSTA
create or replace view propostas_financeiro with (security_invoker = true) as
select
  p.*,
  coalesce((
    select sum(valor_total)
    from notas_fiscais nf
    where nf.proposta_id = p.id and nf.status != 'cancelada'
  ), 0) as total_nfs,

  coalesce((
    select sum(ap.valor_previsto)
    from acordo_parcelas ap
    join acordos_pagamento a on a.id = ap.acordo_id
    where a.proposta_id = p.id
      and a.status not in ('cancelado', 'convertido_nf')
      and ap.status != 'cancelada'
  ), 0) as total_acordos,

  coalesce((
    select sum(pg.valor)
    from pagamentos pg
    join notas_fiscais nf on nf.id = pg.nota_id
    where nf.proposta_id = p.id and nf.status != 'cancelada'
  ), 0) as recebido_nfs,

  -- Recebido via parcelas de acordos desta proposta (apenas acordos vigentes)
  -- Exclui acordos convertidos em NF (já representados na NF de saldo)
  coalesce((
    select sum(pg.valor)
    from pagamentos pg
    join acordo_parcelas ap on ap.id = pg.parcela_acordo_id
    join acordos_pagamento a on a.id = ap.acordo_id
    where a.proposta_id = p.id
      and pg.origem = 'acordo'
      and a.status not in ('cancelado', 'convertido_nf')
  ), 0) as recebido_acordos
from propostas p;

grant select on propostas_financeiro to authenticated;

-- ============================================================
-- FIM DO SCHEMA INICIAL
-- Próximos passos:
-- 1. Rodar este SQL no Supabase SQL Editor
-- 2. Executar 002_rls_policies.sql (políticas de segurança)
-- 3. Executar 003_storage_buckets.sql (buckets de arquivos)
-- 4. Criar seu primeiro usuário admin via Supabase Auth UI
-- 5. Inserir manualmente na tabela profiles vinculando seu auth.users.id à empresa
-- ============================================================
