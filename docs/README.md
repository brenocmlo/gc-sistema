# docs/

Índice da documentação do gc-sistema. Organizado por **trilha de trabalho**, espelhando o
ClickUp. A convenção de nomes e a regra de onde cada coisa mora estão no `CLAUDE.md`, seção
"Documentação".

## Estrutura

| Pasta | O que guarda | Origem no ClickUp |
|---|---|---|
| `sprint-<N>/` | Entregas por bloco da sprint N, um `<m.n>-status-entrega.md` cada | Lista **Plataforma Gestão de Obras**, tag `s<N>` |
| `automacao/` | Trilha de OCR/WhatsApp/Telegram | Lista **OCR Contratos (WhatsApp) — Breno** |
| `tecnicos/` | O que atravessa sprints: nota técnica, processo, auditoria | — |

A divisória entre `sprint-<N>/` e `tecnicos/` é a **vida útil**, não o nome do arquivo: o que
morre junto com a task vai para a sprint; o que continua valendo depois vai para `tecnicos/`,
ainda que fale de uma sprint só.

## Sprint 4 — Fundação de engenharia + Propostas · `sprint-4/`

Concluída em 2026-09-14. Oito blocos, todos fechados no ClickUp.

| Bloco | Documento |
|---|---|
| 4.0 Auditoria de infraestrutura: GitHub e Vercel | — |
| 4.1 Sincronizar schema | `4.1-status-entrega.md`, `4.1-sincronizar-schema-analise.md` |
| 4.2 Propostas: types, helpers e layout-guard | `4.2-status-entrega.md` |
| 4.3 Propostas: tela de listagem | `4.3-status-entrega.md` |
| 4.4 Propostas: formulário de criação | `4.4-status-entrega.md` |
| 4.5 Propostas: detalhes e edição | `4.5-status-entrega.md` |
| 4.6 Propostas: mudança de status e motivo de rejeição | `4.6-status-entrega.md` |
| 4.7 Propostas: anexos e export XLSX | `4.7-status-entrega.md` |
| 4.8 Propostas: seed e roteiro de teste nos 4 perfis | `4.8-status-entrega.md` |

Mais `sprint-4-apresentacao-gestao.md` — o fechamento apresentado à gestão.

## Sprint 5 — Itens (o coração do sistema) · `sprint-5/`

Em andamento.

| Bloco | Documento |
|---|---|
| 5.1 Itens: types, helpers e regras de cálculo | `5.1-status-entrega.md` ✅ |
| 5.2 Itens: tabela editável dentro da proposta | `5.2-status-entrega.md` ✅ |
| 5.3 Itens: formulário completo do item | `5.3-status-entrega.md` ✅ |
| 5.4 Itens: importação em massa via planilha XLSX | `5.4-status-entrega.md` ✅ |
| 5.5 Itens: foto do item | `5.5-status-entrega.md` ✅ (só servidor) |
| 5.6 Itens: recálculo do valor da proposta e do contrato | `5.6-status-entrega.md` ✅ |
| 5.7 Itens: duplicar, reordenar e ações em lote | — |
| 5.8 Itens: seed e testes | — |

> **Fronteira com a trilha `automacao/`:** a sprint 5 corre em paralelo com a rodada do
> Telegram, e as duas se encontram nos helpers de item em `src/lib/`. Quem chegar primeiro
> escreve; o segundo usa o que está lá. A aba "Itens" da tela é da sprint 5; a gravação dos
> itens pela ingestão é da `automacao/`. Ver decisão 3 do plano de migração.

## Sprints 6 a 15 — planejadas

Contratos (6) · Execução: estrutura e apontamento (7) · Execução: evidências e visão
consolidada (8) · Financeiro: Notas Fiscais (9) · Financeiro: Pagamentos (10) ·
Financeiro: Acordos e parcelas (11) · Painel financeiro e Dashboard (12) · Administração,
qualidade e segurança (13) · Migração da planilha e go-live (14) · Treinamento e
estabilização (15).

Cada uma ganha `docs/sprint-<N>/` ao abrir o primeiro bloco.

## Automação · `automacao/`

Trilha separada, com **numeração própria de 1 a 8** na lista do ClickUp — não usa blocos
`m.n`, e por isso os documentos aqui levam nome descritivo.

| Documento | O que é |
|---|---|
| `migracao-telegram-integracao-automacao.md` | O plano da rodada: migrar de Z-API para Telegram e fazer a proposta entrar sozinha no sistema. 19 decisões fechadas (6 de 22/09), 8 fases |
| `fase-1-contatos-canal-status-entrega.md` | Entrega da Fase 1 (migration de identidade de canal) |
| `fase-0-runbook.md` | Fase 0 dividida: Parte A (Telegram, manual) e Parte B (n8n) |
| `fase-0-parte-a-telegram-passo-a-passo.md` | Os nove passos da Parte A: criar os dois bots, o grupo de admin e pegar os `chat_id` |
| `fase-0-status-entrega.md` | Entrega da Fase 0: bots, Credentials, prova do Telegram Trigger e decisão 6 fechada (CHECK não muda) |
| `fase-2-notificar-e-simplificacao-status-entrega.md` | Fase 2 (`Notificar`) e a simplificação: 8 workflows viram 3, Z-API removida, só propostas, testado com PDF real |
| `fase-4-telegram-como-gatilho-status-entrega.md` | Fase 4: o Telegram vira gatilho do `Processar Documento`; testado até a extração (cota do Gemini pendente) |
| `fase-5-extracao-itens-status-entrega.md` | Fase 5: prompt com os 14 campos do item e parse; testado offline 12/12, teste real pendente da cota do Gemini |

## Técnicos · `tecnicos/`

| Documento | O que é |
|---|---|
| `plano-validacao.md` | As sete camadas de `npm run validar`, o que cada uma prova e o que **não** prova |
| `auditoria-cobertura-sprint-4.md` | Os modos de falhar do próprio plano de validação — leia antes de mexer nos scripts |
| `correcoes-listagens-e-obras.md` | Os três bugs achados ao fechar as lacunas do bloco 4.3 |
| `README.md` | Índice da pasta |
