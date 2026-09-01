# GC Sistema — Gestão de Contratos

Sistema interno de gestão do ciclo comercial e financeiro de obras: do orçamento
ao contrato, da execução ao recebimento, incluindo a conciliação de **Faturamento
Direto (FD)**.

> **Repositório privado.** Contém a modelagem financeira da empresa (percentuais
> de sinal/FD/medição, regras de conciliação, políticas de acesso). Não tornar
> público e não publicar dumps, prints de dados reais ou chaves em issues/PRs.

---

## Stack

| Camada | Tecnologia |
| --- | --- |
| Framework | Next.js 14 (App Router, Server Components, TypeScript strict) |
| UI | Tailwind CSS 3, lucide-react, sonner (toasts) |
| Formulários | react-hook-form + zod (`@hookform/resolvers`) |
| Backend / Auth / Storage | Supabase (Postgres + RLS + Auth + Storage) via `@supabase/ssr` |
| Exportação | exceljs (XLSX), @react-pdf/renderer (PDF) |
| Hospedagem | Vercel (deploy automático a cada push em `main`) |

## Rodando localmente

Pré-requisitos: Node 20+ e npm (o lockfile versionado é o `package-lock.json`).

```bash
npm install
cp .env.local.example .env.local   # preencher com as credenciais do projeto gc-dev
npm run dev                        # http://localhost:3000
```

Outros scripts:

```bash
npm run build     # build de produção (o mesmo que a Vercel roda)
npm run lint      # ESLint (eslint-config-next)
npm run db:types  # regenera src/lib/supabase/types.ts a partir do schema do Supabase
```

### Variáveis de ambiente

| Variável | Onde é usada | Obrigatória |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | client, server e middleware | sim |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client, server e middleware | sim |
| `SUPABASE_SERVICE_ROLE_KEY` | reservada para uso server-side (ainda não consumida pelo código) | não |

`.env.local` é ignorado pelo git (`.env*.local` no `.gitignore`) e **nunca** deve
ser versionado. Ao adicionar uma variável nova, atualize `.env.local.example` no
mesmo commit.

## Ambientes

| Ambiente | Projeto Supabase | Uso |
| --- | --- | --- |
| Desenvolvimento | `gc-dev` | desenvolvimento local; `npm run db:types` aponta pra cá |
| Produção | `gc-prod` | deploy da Vercel a partir de `main` |

As env vars de produção ficam nas Project Settings da Vercel — não há `.env` de
produção no repositório.

## Arquitetura

```
src/
  app/
    login/                 tela de login (react-hook-form + zod)
    (app)/                 route group autenticado (Sidebar + Header)
      page.tsx             dashboard
      clientes/            CRUD
      orcamentos/          CRUD + detalhe
      obras/               CRUD + detalhe (valores calculados)
      propostas/           em construção
      contratos/           em construção
      execucao/            em construção
      financeiro/          em construção
      fd/                  Faturamento Direto: CRUD, detalhe, conciliação
      configuracoes/       somente admin
    api/
      export/{fd,obras,orcamentos}/        exportação XLSX
      relatorio/fd-conciliacao/[obraId]/   relatório PDF de conciliação
  components/              DataTable, Modal, ConfirmDialog, FileUpload, form/*, ...
  lib/
    supabase/{client,server,middleware,profile,types}.ts
    auth-guards.ts         requirePerfil() para proteger layouts/páginas
    nav.ts                 menu por perfil (fonte única de verdade da navegação)
    fd.ts, format.ts, phone.ts, files.ts, excel-export.ts, pdf/
supabase/                  migrations SQL numeradas (000..010) + seeds
```

### Autenticação e autorização

- O `middleware` do Next renova a sessão do Supabase e redireciona: não
  autenticado → `/login`; autenticado em `/login` → `/`.
- Nas rotas protegidas, `requirePerfil([...])` (em `src/lib/auth-guards.ts`)
  valida o perfil no server: sem perfil → `/login`; perfil fora da allow-list → `/`.
- O menu lateral é filtrado por perfil em `src/lib/nav.ts`.
- No banco, **RLS** é a última linha de defesa: isolamento multi-tenant por
  `empresa_id` (`current_empresa_id()`) e permissão por perfil (`has_perfil()`).

Perfis: `admin`, `comercial`, `producao`, `medicao`, `financeiro`, `visualizador`.

| Módulo | Perfis com acesso |
| --- | --- |
| Dashboard, Obras | todos |
| Clientes, Orçamentos, Propostas, Contratos | admin, comercial, visualizador |
| Execução | admin, producao, medicao, visualizador |
| Financeiro, Faturamento Direto | admin, financeiro, visualizador |
| Configurações | admin |

## Domínio

- **Orçamento** → **Proposta** → **Contrato** → **Obra**: a obra carrega o valor
  total, o desconto e os percentuais de recebimento (`pct_sinal`, `pct_fd`,
  `pct_entrega_material`, `pct_medicao_instalacao`).
- **Itens** e **Execução**: os itens da obra alimentam a execução (quantidades e
  valores sincronizados por trigger); o progresso é medido pela execução.
- **Financeiro**: notas fiscais, pagamentos, acordos de pagamento e parcelas, com
  status recalculado por triggers (`atualizar_status_parcela`,
  `atualizar_parcelas_atrasadas`, `atualizar_status_acordo`, ...).
- **FD (Faturamento Direto)**: lançamentos em que o cliente compra direto do
  fornecedor. Registra `valor` (o que o cliente gastou) e `valor_descontar` (o que
  aceitamos descontar); `diferenca_favor` é coluna gerada (`valor - valor_descontar`)
  e representa a diferença a nosso favor. Evidências (NFs, planilhas, e-mails)
  ficam em `evidencias jsonb` + Storage. O relatório de conciliação por obra sai
  em PDF e a listagem em XLSX.

Views principais: `obras_com_valores`, `obras_financeiro`, `contratos_financeiro`,
`propostas_financeiro`, `receitas_obra`, `itens_com_status`.

## Banco de dados

As migrations ficam em `supabase/`, numeradas e aplicadas **em ordem**:

| Arquivo | Conteúdo |
| --- | --- |
| `000_reset_dev.sql` | reset do schema (apenas em gc-dev) |
| `001_initial.sql` | tabelas, views, funções e triggers |
| `002_rls_policies.sql` | políticas RLS |
| `003_storage_buckets.sql` | buckets de documentos, anexos e evidências |
| `004_revisao_schema.sql` | revisão do schema |
| `005_rls_clientes.sql` | policies RLS de `clientes` |
| `006_fix_calcular_valores_obra.sql` | correção de `calcular_valores_obra` |
| `007_progresso_itens_obra.sql` | progresso de itens/execução |
| `008_documentos_processamento.sql` | documentos de processamento |
| `009_contatos_whatsapp.sql` | contatos de WhatsApp |
| `010_storage_bucket_documentos_processamento.sql` | bucket dos documentos de processamento |

Seeds/apoio: `setup_inicial_dev.sql`, `seed_orcamentos.sql`.
`supabase/reset_e_aplicar_tudo.sql` é gerado por concatenação e **não** é versionado.

Depois de mudar o schema, rode `npm run db:types` e commite `src/lib/supabase/types.ts`.

## Deploy

- A Vercel builda e publica **Production** a cada push em `main`; não há workflows
  de CI no GitHub Actions.
- Antes de abrir PR: `npm run lint && npm run build`.
- Env vars de produção são configuradas nas Project Settings da Vercel.

## Convenções

- Nomes de domínio (tabelas, campos, rotas, labels) em **português**; nomes de
  framework em inglês.
- TypeScript strict; alias de import `@/*` → `src/*`.
- Server Components por padrão; `'use client'` só onde há interatividade
  (normalmente um wrapper por listagem/formulário).
- Formulários: react-hook-form + schema zod compartilhado com a validação do server.
- Toda tabela nova precisa de `empresa_id`, RLS habilitada e policies de
  isolamento + perfil no mesmo commit da migration.
