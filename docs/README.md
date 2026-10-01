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

Concluída em 2026-09-23. Oito blocos, todos fechados no ClickUp.

| Bloco | Documento |
|---|---|
| 5.1 Itens: types, helpers e regras de cálculo | `5.1-status-entrega.md` ✅ |
| 5.2 Itens: tabela editável dentro da proposta | `5.2-status-entrega.md` ✅ |
| 5.3 Itens: formulário completo do item | `5.3-status-entrega.md` ✅ |
| 5.4 Itens: importação em massa via planilha XLSX | `5.4-status-entrega.md` ✅ |
| 5.5 Itens: foto do item | `5.5-status-entrega.md` ✅ (só servidor) |
| 5.6 Itens: recálculo do valor da proposta e do contrato | `5.6-status-entrega.md` ✅ |
| 5.7 Itens: duplicar, reordenar e ações em lote | `5.7-status-entrega.md` ✅ |
| 5.8 Itens: seed e testes | `5.8-status-entrega.md` ✅ |

> **Fronteira com a trilha `automacao/`:** a sprint 5 corre em paralelo com a rodada do
> Telegram, e as duas se encontram nos helpers de item em `src/lib/`. Quem chegar primeiro
> escreve; o segundo usa o que está lá. A aba "Itens" da tela é da sprint 5; a gravação dos
> itens pela ingestão é da `automacao/`. Ver decisão 3 do plano de migração.

## Sprint 6 — Contratos · `sprint-6/`

Aberta em 2026-09-23. Blocos fechados um de cada vez.

| Bloco | Documento |
|---|---|
| 6.1 Contratos: types, helpers e listagem | `6.1-status-entrega.md` ✅ |
| 6.2 Contratos: gerar contrato a partir de proposta aprovada | `6.2-status-entrega.md` ✅ |
| 6.3 Contratos: formulário de criação avulsa | `6.3-status-entrega.md` ✅ |
| 6.4 Contratos: detalhes, edição e abas | `6.4-status-entrega.md` — implementado, validação pendente para o fechamento da sprint |
| 6.5 Contratos: mudança de status e rescisão | `6.5-status-entrega.md` — implementado, validação pendente para o fechamento da sprint |
| 6.6 Contratos: anexos, export e testes (fechamento) | `6.6-status-entrega.md` — implementado; rodada de fechamento a cargo do Breno |

## Sprint 7 — Execução: estrutura e apontamento · `sprint-7/`

Aberta em 2026-09-23, **fechada em 2026-09-24** com as sete camadas do plano passando.

| Bloco | Documento |
|---|---|
| 7.1 Execução: types, helpers e regras de cascata | `7.1-status-entrega.md` — validado |
| 7.2 Execução: listagem por obra | `7.2-status-entrega.md` — validado |
| 7.3 Execução: painel de apontamento | `7.3-status-entrega.md` — validado |
| 7.4 Execução: múltiplas execuções por item | `7.4-status-entrega.md` — validado; migration aplicada em gc-dev |
| 7.5 Execução: previsões, responsáveis e alertas de atraso | `7.5-status-entrega.md` — validado |
| 7.6 Execução: testes de cascata (fechamento) | `7.6-status-entrega.md` — rodada de fechamento, 2 migrations do fechamento |

## Sprint 8 — Execução: evidências e visão consolidada · `sprint-8/`

Aberta em 2026-09-25, **fechada em 2026-09-28** com as sete camadas do plano passando. O teste
no celular fica a cargo do Breno.

| Bloco | Documento |
|---|---|
| 8.1 Execução: upload de evidências por etapa | `8.1-status-entrega.md` — validado |
| 8.2 Execução: uso em campo (mobile) | `8.2-status-entrega.md` — validado; aparelho real a cargo do Breno |
| 8.3 Obra: aba de execução consolidada | `8.3-status-entrega.md` — validado |
| 8.4 Relatório PDF de medição por obra | `8.4-status-entrega.md` — validado; migration aplicada em gc-dev |
| 8.5 Execução: export XLSX e testes (fechamento) | `8.5-status-entrega.md` — rodada de fechamento; migration do deadlock |

## Sprint 9 — Financeiro: Notas Fiscais · `sprint-9/`

Aberta em 2026-09-28, **fechada em 2026-09-29** com as sete camadas do plano passando. O teste
no celular fica a cargo do Breno.

| Bloco | Documento |
|---|---|
| 9.1 NF: types, helpers e listagem | `9.1-status-entrega.md` — validado no fechamento (9.6) |
| 9.2 NF: formulário de criação | `9.2-status-entrega.md` — validado no fechamento (9.6) |
| 9.3 NF: detalhes, edição e abas | `9.3-status-entrega.md` — validado no fechamento (9.6) |
| 9.4 NF: cancelamento como status terminal | `9.4-status-entrega.md` — validado no fechamento (9.6); migration aplicada em gc-dev |
| 9.5 NF: upload de XML e PDF | `9.5-status-entrega.md` — validado no fechamento (9.6) |
| 9.6 NF: export XLSX, seed e testes (fechamento) | `9.6-status-entrega.md` — rodada de fechamento |

## Sprint 10 — Financeiro: Pagamentos · `sprint-10/`

Aberta em 2026-09-30, **fechada em 2026-09-30** com as sete camadas do plano passando numa
rodada só. O teste no celular fica a cargo do Breno.

| Bloco | Documento |
|---|---|
| 10.1 Pagamentos: types, helpers e listagem | `10.1-status-entrega.md` — validado no fechamento (10.6) |
| 10.2 Pagamentos: formulário de registro | `10.2-status-entrega.md` — validado no fechamento (10.6) |
| 10.3 Pagamentos: baixa rápida a partir da NF e da parcela | `10.3-status-entrega.md` — validado no fechamento (10.6); estorno adiantado do 10.4 |
| 10.4 Pagamentos: comprovante e estorno | `10.4-status-entrega.md` — validado no fechamento (10.6) |
| 10.5 Validar a cascata de status via trigger | `10.5-status-entrega.md` — verificado em gc-dev (18/18), sem divergência, sem migration |
| 10.6 Pagamentos: export, seed e testes (fechamento) | `10.6-status-entrega.md` — rodada de fechamento; corrigiu os filtros da listagem (10.1) |

## Sprint 13 — Administração, qualidade e segurança · `sprint-13/`

Um bloco **adiantado** em 2026-09-23, a pedido do Breno: a tela de logs e auditoria.

| Bloco | Documento |
|---|---|
| 13.2 Histórico e auditoria de mudanças | `13.2-status-entrega.md` (etapa A: banco, trigger e tela `/logs`; B e C pendentes) |

## Sprints 7 a 15 — planejadas

Execução: estrutura e apontamento (7) · Execução: evidências e visão
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
| `migracao-telegram-integracao-automacao.md` | O plano da rodada: migrar de Z-API para Telegram e fazer a proposta entrar sozinha no sistema. 29 decisões fechadas, 8 fases |
| `fase-1-contatos-canal-status-entrega.md` | Entrega da Fase 1 (migration de identidade de canal) |
| `fase-0-runbook.md` | Fase 0 dividida: Parte A (Telegram, manual) e Parte B (n8n) |
| `fase-0-parte-a-telegram-passo-a-passo.md` | Os nove passos da Parte A: criar os dois bots, o grupo de admin e pegar os `chat_id` |
| `fase-0-status-entrega.md` | Entrega da Fase 0: bots, Credentials, prova do Telegram Trigger e decisão 6 fechada (CHECK não muda) |
| `fase-2-notificar-e-simplificacao-status-entrega.md` | Fase 2 (`Notificar`) e a simplificação: 8 workflows viram 3, Z-API removida, só propostas, testado com PDF real |
| `fase-4-telegram-como-gatilho-status-entrega.md` | Fase 4: o Telegram vira gatilho do `Processar Documento`; testado até a extração (cota do Gemini pendente) |
| `fase-5-extracao-itens-status-entrega.md` | Fase 5: extração dos itens, Gemini real 4/4; reserva pela Groq (decisão 20) com trava para texto embaralhado |
| `fase-6-rota-ingestao-status-entrega.md` | Fase 6: rota `/api/ingestao/proposta` pronta; até ela ser alcançável, o n8n grava proposta e itens com a mesma regra (decisão 21) |
| `fase-7-painel-status-entrega.md` | Fase 7: `/configuracoes/contatos` e `/documentos` (lista, detalhe, envio pela tela) implementadas, validação pendente |
| `contratos-revisao-e-rotas-status-entrega.md` | Contratos pelo bot, revisão pela tela, n8n pelas rotas e obra lida do PDF (decisão 27) |

## Técnicos · `tecnicos/`

| Documento | O que é |
|---|---|
| `plano-validacao.md` | As sete camadas de `npm run validar`, o que cada uma prova e o que **não** prova |
| `auditoria-cobertura-sprint-4.md` | Os modos de falhar do próprio plano de validação — leia antes de mexer nos scripts |
| `correcoes-listagens-e-obras.md` | Os três bugs achados ao fechar as lacunas do bloco 4.3 |
| `README.md` | Índice da pasta |
