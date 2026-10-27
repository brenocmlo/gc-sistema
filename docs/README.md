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

## Sprint 11 — Financeiro: Acordos e parcelas · `sprint-11/`

Aberta em 2026-09-30 e fechada em 2026-10-01, validada no 11.5. A partir daqui, a validação roda ao fim de cada bloco.

| Bloco | Documento |
|---|---|
| 11.1 Acordos: types, helpers e listagem | `11.1-status-entrega.md` — implementado; validado no fechamento da sprint (11.5) |
| 11.2 Acordos: criação com geração de parcelas | `11.2-status-entrega.md` — implementado; validado no fechamento da sprint (11.5); migration 036 aplicada em gc-dev |
| 11.3 Acordos: tela de detalhes com parcelas | `11.3-status-entrega.md` — implementado; validado no fechamento da sprint (11.5) |
| 11.4 Acordos: conversão em nota fiscal | `11.4-status-entrega.md` — implementado; validado no fechamento da sprint (11.5); migration 037 aplicada em gc-dev; prova das views 13/13 |
| 11.5 Acordos: encerramento, export e testes | `11.5-status-entrega.md` — **fechamento da sprint: as sete camadas passam** (unitário 355, build 58, runtime 251/251, dados 51/51, escrita 474/474, navegador 209/209); cancelar acordo com pagamento encerra pelo recebido; os blocos 11.1 a 11.4 ficam validados por esta rodada |

## Sprint 12 — Painel financeiro e Dashboard · `sprint-12/`

Aberta em 2026-10-01 e fechada em 2026-10-05, validada no 12.5. É a primeira sprint com a validação ao fim de cada bloco.

| Bloco | Documento |
|---|---|
| 12.1 Obra: aba financeira consolidada | `12.1-status-entrega.md` — implementado e validado (sete camadas: unitário 359, runtime 257/257, dados 52/52, escrita 474/474, navegador 212/212); números conferidos contra o SQL manual |
| 12.2 Tela /financeiro: visão consolidada da empresa | `12.2-status-entrega.md` — implementado e validado (unitário 363, build 60, runtime 267/267, dados 53/53, escrita 474/474, navegador 216/216); o menu Financeiro abre na visão geral |
| 12.3 Dashboard: página inicial com KPIs | `12.3-status-entrega.md` — implementado e validado (unitário 369, build 60, runtime 273/273, dados 54/54, escrita 474/474, navegador 220/220); a home deixa de ser o "Em construção", com seções, pendências e atalhos por perfil |
| 12.4 Dashboard: gráficos | `12.4-status-entrega.md` — implementado e validado (unitário 373, build 60, runtime 277/277, dados 55/55, escrita 474/474, navegador 224/224); recharts 3.10.1; funil, receita de 12 meses, progresso das obras e motivos de rejeição |
| 12.5 Conferência dos números e testes | `12.5-status-entrega.md` — **fechamento da sprint: as sete camadas passam** (unitário 373, build 60, runtime 289/289, dados 56/56, escrita 474/474, navegador 249/249); 75 KPIs = SQL escrito à mão (`supabase/conferencia_kpis.sql`); obra com FD, acordo convertido e NF cancelada; matriz de perfis com clique; conferência visual medida pelo Playwright |

## Sprint 13 — Administração, qualidade e segurança · `sprint-13/`

Fechada em 2026-10-10, validada no 13.5. O 13.2 começou **adiantado**, em 2026-09-23, a pedido do Breno.

| Bloco | Documento |
|---|---|
| 13.1 Gestão de usuários | `13.1-status-entrega.md` — **validado: as sete camadas passam** (unitário 379, build 64, runtime 296/296, dados 57/57, escrita 495/495, navegador 254/254); convite por link sem e-mail, desativação com bloqueio no Auth; migration `20261005120000` corrige a autopromoção a admin e o acesso do usuário inativo |
| 13.2 Histórico e auditoria de mudanças | `13.2-status-entrega.md` — **validado em 2026-10-06: as sete camadas passam** (unitário 385, build 64, runtime 298/298, dados 58/58, escrita 496/496, navegador 256/256); etapa A (banco, trigger e `/logs`), etapa B (erro de escrita gravado pelo `fetch` do client do servidor) e aba Histórico da NF (migration `20261006100000`); etapa C coberta pelo `automacao_eventos`, confirmado pelo Breno em 2026-10-07 |
| 13.3 Revisão de RLS ponta a ponta | `13.3-status-entrega.md` — **validado em 2026-10-10: as sete camadas passam** (unitário 393, build 65, runtime 298/298 + 342 células de URL direta, dados 60/60 com a matriz de 564 células, escrita 505/505, navegador 256/256); 6 pontos frouxos corrigidos (migrations `20261007100000` e `20261007110000`, guarda nas rotas de FD), regressão do recálculo de valor desfeita (`20261007120000`), matriz perfil × tabela × CRUD × bucket × rota em `scripts/validacao/matriz-rls.json`, conferida pelas camadas dados e runtime |
| 13.4 Tratamento de erro, loading e estados vazios | `13.4-status-entrega.md` — **validado em 2026-10-10: as sete camadas passam** (unitário 397, build 65, runtime 319/319, dados 60/60, escrita 506/506, navegador 260/260); error/not-found globais e por detalhe, skeleton em 13 telas (grupo `(lista)` para não atrasar os redirects de perfil), erro do Postgres traduzido (`src/lib/erro-banco.ts`), "Limpar filtros" e toasts padronizados |
| 13.5 Testes automatizados de fumaça | `13.5-status-entrega.md` — **fechamento da sprint: as sete camadas passam** (unitário 397, build 65, runtime 319/319, dados 60/60, escrita 506/506, navegador 260/260); `validar.sh fumaca` com os 4 caminhos críticos (22/22, ~1min30), sem Playwright por decisão do Breno; CI em `.github/workflows/validar.yml` (não está no GitHub ainda) |

## Sprint 14 — Migração da planilha e go-live · `sprint-14/`

**Sprint fechada em 2026-10-27.** Fora do alcance por decisão do Breno: a planilha real "Gestão Contratos.xlsx"
(importação real e conferência contra os totais do card), o acesso aos 32 arquivos do Drive e o gc-prod.

Aberta em 2026-10-12. Tudo rodou sobre a planilha falsa. As decisões do 14.1 foram tomadas por análise, por delegação do Breno. Em 26/10 o Breno
decidiu que não se faz nada em gc-prod: o go-live e a infraestrutura (14.4 e 14.5) são ensaiados em
gc-dev.

| Bloco | Documento |
|---|---|
| 14.1 Decisões de mapeamento | `14.1-status-entrega.md` — **decidido em 2026-10-26, por análise, por delegação do Breno** (revisáveis): clientes, contratos (um por obra com proposta aprovada), regra da execução, Drive e data de corte (virada 13/11/2026, `--ate 2026-11-12`, reserva 27/11); aplicadas no código em 26/10 (importador 17/17, conciliação 41/41); **fechado em 2026-10-27**, validado nas sete camadas |
| 14.2 Script de importação | `14.2-status-entrega.md` — **fechado em 2026-10-27**, validado nas sete camadas (ensaio 17/17 com as decisões do 14.1, escrita 529/529); importação real fora do alcance (decisão do Breno, 27/10); importador em `scripts/importacao/` com simulação, idempotência, log de ignoradas e `--desfazer`; ensaio sobre planilha falsa (17 passos) na camada escrita; mapa de colunas provisório |
| 14.3 Importar em gc-dev e conciliar | `14.3-status-entrega.md` — **fechado em 2026-10-27**, validado no que a planilha falsa alcança (8 testes novos): comparação pura testada (`src/lib/conciliacao.ts`), `conciliar.mjs`, já integrada ao ensaio (41/41); importação e conciliação reais fora do alcance (decisão do Breno, 27/10) |
| 14.4 Go-live | `14.4-status-entrega.md` — **ensaio da virada executado em gc-dev (26/10); rodada completa de 27/10 passou**; procedimento em `tecnicos/runbook-producao.md`; gc-prod fora do escopo por decisão do Breno (26/10) |
| 14.5 Infraestrutura | `14.5-status-entrega.md` — **ensaio executado em gc-dev (26/10); rodada completa de 27/10 passou**: backup e teste de restauração; domínio, Vercel de prod e backup do plano pago ficam como registro |
| 14.6 Documentos do Google Drive | `14.6-status-entrega.md` — **fechado em 2026-10-27** (`baixar-drive.mjs`, simulação sobre a planilha falsa); links continuam como texto na observação (decisão 4); download real fora do alcance (decisão do Breno, 27/10) |
| Fora de bloco: "Esqueci minha senha" | `esqueci-minha-senha-status-entrega.md` — **validado em 2026-10-19: as sete camadas passam** (unitário 409, build 65, runtime 319/319, dados 63/63, escrita 520/520, navegador 266/266); o pedido vai ao admin, sem e-mail; migration `20261019100000` |
| Fora de bloco: "Meu perfil" | `meu-perfil-status-entrega.md` — **validado em 2026-10-27: as sete camadas passam** (unitário 432, build 66, runtime 327/327 + 348 células, dados 65/65, escrita 529/529, navegador 281/281); aba `/configuracoes/perfil` para todos os perfis: nome, telefone e troca de senha conferindo a atual; sem migration |
| Fora de bloco: progresso da obra | `progresso-obra-status-entrega.md` — **validado em 2026-10-27** (migration `20261026100000`: `progresso_itens_pct` só conta itens contratados; 7 testes e 1 checagem de dados novos; sete camadas passam) |
| Fora de bloco: perguntas à equipe | `perguntas-para-a-equipe.md` e a versão curta `perguntas-para-a-equipe-curta.md` — o que falta para começar a sprint |

## Sprint 15 — Treinamento e estabilização · `sprint-15/`

**Sprint fechada em 2026-10-27.** Fora do alcance por decisão do Breno: o treinamento presencial e o uso real.

Aberta em 2026-10-26. Material preparado; o sistema roda em gc-dev e o go-live foi ensaiado lá.

| Bloco | Documento |
|---|---|
| 15.1 Manuais por perfil | `15.1-status-entrega.md`; guias em `tecnicos/manual-admin.md`, `manual-comercial.md`, `manual-financeiro.md` e `manual-producao-medicao.md` — **escritos, com as telas da rodada de 27/10 embutidas no PDF** (20, 15, 23 e 15); pendente: leitura por usuário real e publicação |
| 15.2 Treinamento presencial por perfil | `15.2-status-entrega.md` e `15.2-roteiro-treinamento.md` — **fechado em 2026-10-27** com o roteiro preparado; sessões fora do alcance (decisão do Breno, 27/10) |
| 15.3 Correção de bugs do uso real | `15.3-status-entrega.md` e `15.3-processo-bugs.md` — **fechado em 2026-10-27** com o processo preparado; uso real fora do alcance (decisão do Breno, 27/10) |

## Sprints 7 a 13 — pastas por sprint

Execução: estrutura e apontamento (7) · Execução: evidências e visão
consolidada (8) · Financeiro: Notas Fiscais (9) · Financeiro: Pagamentos (10) ·
Financeiro: Acordos e parcelas (11) · Painel financeiro e Dashboard (12) · Administração,
qualidade e segurança (13). As sprints 14 e 15 já estão abertas, nas seções acima.

Cada sprint ganha `docs/sprint-<N>/` ao abrir o primeiro bloco.

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
| `exportacoes-xlsx.md` | O padrão visual das planilhas de `/api/export/*` (o gerador compartilhado) e o que mudou no FD |
| `regra-um-contrato-por-obra.md` | Levantamento da regra "uma obra, um contrato vigente" na tela: o que quebra (seed, testes, 6.2) e o passo a passo para a trilha de sprint |
| `runbook-producao.md` | O go-live e a operação do gc-prod, como registro (gc-prod fora do escopo por decisão do Breno em 26/10); o ensaio é feito em gc-dev nos blocos 14.4 e 14.5 |
| `manual-admin.md` | Manual do perfil admin (bloco 15.1) |
| `manual-comercial.md` | Manual do perfil comercial (bloco 15.1) |
| `manual-financeiro.md` | Manual do perfil financeiro (bloco 15.1) |
| `manual-producao-medicao.md` | Manual dos perfis de produção e medição (bloco 15.1) |
| `README.md` | Índice da pasta |
