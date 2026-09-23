# Fase 5 — Extração completa dos itens da proposta · status de entrega

> **Sem número de bloco.** Trilha da automação, lista **"OCR Contratos (WhatsApp) — Breno"**
> do ClickUp, numeração própria de 1 a 8. Ver `docs/README.md` e o `CLAUDE.md`.

Data: 2026-09-23 · Branch: `feature-dev-breno-automacao` · Ambiente: n8n Cloud
`ederbox.app.n8n.cloud` · Plano: `docs/automacao/migracao-telegram-integracao-automacao.md`,
Fase 5 e decisões 10 e 11.

---

## Resumo

**Construída e testada.** Offline contra o gabarito: **16/16** casos. Com o **Gemini real**
(23/09, cota renovada): a proposta `PROP-2026-0117` saiu com os **4 itens iguais ao
gabarito**, unidades literais. Ganhou uma **reserva pela Groq** (decisão 20, seção 5). Falta o
PDF de 16 itens pelo Gemini real e o reenvio pelo Telegram — travados pelo limite de execuções
do n8n (seção 5.4).

A Fase 5 **extrai** os itens; quem os **grava** em `itens` é a Fase 6. Até lá, os itens
ficam em `documentos_processamento.dados_extraidos`.

---

## 1. O que mudou no `Processar Documento` (`thlKSZcBPX84Y51N`)

O plano apontava para o `Ingestão e Extração`, que foi absorvido pelo `Processar Documento`
na Fase 2 — as mudanças estão lá.

### Prompt do Gemini

Os 7 campos de cabeçalho ficam como estavam. Cada item passa a voltar com as **14 chaves**
do plano: `numero, tipo, linha, acabamento, localizacao, descricao, quantidade, unidade,
valor_unitario, valor_total, largura, altura, vidros, observacao`. Regras escritas no prompt:

- **não inventar** — campo ausente volta `null`, nunca o valor mais comum;
- `numero` é o `Item: N` do documento, **como string e literal** (`'09'`, `'1.1'`);
- `unidade` **literal**, sem converter (`UN`, `m2`, `ML`) — a tradução é do helper;
- `valor_total` **sempre**, mesmo sem unitário (decisão 10);
- **aviso do deslocamento de linha**: o número do unitário pode vir na linha abaixo do
  rótulo (seção 3);
- largura e altura como escritas, sem converter unidade;
- formato brasileiro vira number.

### `Analisar e decidir`

- Converte formato brasileiro robustamente, **mesmo que o modelo devolva string**
  (`'R$ 1.986,08'`, `'02'`).
- Mantém `numero` e `unidade` **literais**. A tradução para as colunas é da Fase 6, com os
  helpers que a sprint 5 já escreveu em `src/lib/itens.ts`: `numeroItemDoDocumento`,
  `normalizarUnidade` e `resolverValorUnit`/`notaDeInferencia`. Não foram duplicados no n8n.
- Diagnóstico, **sem bloquear a proposta** (os itens ainda não são gravados):
  `itensSemUnitario` (serão inferidos, decisão 10), `itensSemConserto` (sem nenhum dos dois
  valores, ou sem quantidade), e `divergeSoma` (soma dos itens vs. total, tolerância de 1%).
  A soma usa o `valor_total` do item quando existe — não soma zero em silêncio para item sem
  unitário, que era o risco que o plano pedia para conferir.
- O aviso de `[PROPOSTA REGISTRADA]` ao grupo ganhou o resumo: *"16 itens extraídos · 7 sem
  valor unitário (será calculado)"*, mais alertas quando houver.

`n8n_validate_workflow`: `valid: true`.

---

## 2. Teste offline — 12/12

O código do `Analisar e decidir` foi baixado do n8n e executado em `node` com uma resposta
simulada do Gemini montada a partir do gabarito da seção 3 (inclusive valores em string
brasileira, para provar a conversão). Sem gastar cota.

| Caso | Resultado |
|---|---|
| desfecho | `PROPOSTA` |
| itens | **16** |
| total `'R$ 121.656,19'` | 121656.19 |
| sem valor unitário | **1, 2, 3, 4, 5, 6, 8** — igual ao gabarito |
| sem conserto | nenhum |
| item 12: `'02' × '1.986,08' = '3.972,16'` | 2 × 1986.08 = 3972.16 |
| item 9: `13 × 'R$120,00'` | 13 × 120 |
| item 13: largura/altura literais | 950 / 2100 |
| soma dos itens vs. total | 121656.19, sem divergência |
| literais | `tipo: FC09`, `numero: '1'` |
| item sem valor e item com quantidade 0 | detectados como sem conserto, **proposta não bloqueada** |
| documento de contrato | continua indo para `REVISAO_HUMANA` (decisão 18) |

**O que isto prova e o que não prova:** prova o parse, a conversão e o diagnóstico. **Não**
prova que o Gemini devolve esses valores — é o teste pendente.

---

## 3. Gabaritos para o teste real

### 3.1 `PROP. COM. - EF _ ADITIVOS_15 12 2025.pdf` — proposta `EB-25-08-0048`

Conferido no texto do PDF (`pdftotext -layout`). **16 itens**, total R$ 121.656,19.

| Itens | Linha | Valor unitário |
|---|---|---|
| 1–6, 8 | MERCADO | **ausente** (7 itens) |
| 7 (R$ 500 × 1… total R$ 1.500), 9 (13 × R$ 120) | MERCADO | presente |
| 10–16 | SUPREMA | presente |

- **Correção do plano:** ele dizia 11 sem unitário. Nos itens 11–16 o número do unitário cai
  na linha abaixo do rótulo `Valor unit.:`; a contagem de 21/09 leu o rótulo vazio. O item 12
  prova: R$ 1.986,08 × 2 = R$ 3.972,16. Corrigido no plano.
- Item 7: o documento diz quantidade 1, unitário R$ 500 e total R$ 1.500 ("AJUSTE 03
  PORTAS"). **O papel é inconsistente** (1 × 500 ≠ 1.500); a divergência deve aparecer no
  teste real e é do documento, não da extração.
- Item 13: largura 950 e altura 2100 (milímetros), acabamento `PINTURA BRANCO BRILHANTE`.
- Item 9: tipo `FC09`. Nenhum item traz unidade, vidros ou observação.
- **Essa proposta já existe no gc-dev** (criada em 06/08/2026 pelo fluxo antigo, sem autor e
  sem itens). O reteste vai dar "número duplicado" → `REVISAO_HUMANA` — e os 16 itens ficam
  gravados em `dados_extraidos` do documento, que é o que o aceite desta fase confere. A
  proposta antiga **não** foi apagada: é dado anterior, não criado por esta frente.

### 3.2 `PROPOSTA PROP-2026-0117 - Vista Verde.pdf` — prova a criação

Nova no gc-dev. Layout diferente (tabela). **4 itens**, total R$ 248.500,00, todos com
unitário:

| Item | Un. | Qtd. | Unitário | Total |
|---|---|---|---|---|
| 1 | `un` | 1 | 128.000,00 | 128.000,00 |
| 2 | `m2` | 420 | 185,00 | 77.700,00 |
| 3 | `m` | 96 | 240,00 | 23.040,00 |
| 4 | `un` | 1 | 19.760,00 | 19.760,00 |

As unidades têm de voltar **literais** — `m` não é `QTD` nem `M2`, e é exatamente o caso que a
decisão 11 manda o helper tratar (vira `QTD`, com o original em `observacao`).

---

## 4. Pendências nominais

1. **Teste com o Gemini real**, pelo Telegram, com os dois PDFs da seção 3, depois que a cota
   renovar. Aceite: os itens em `dados_extraidos` batem com os gabaritos item a item.
2. **Os itens não são gravados em `itens`.** Fase 6.
3. **Largura e altura vêm em milímetros** no documento de referência; a coluna é em metros
   (`formatDimensao` da sprint 5). A conversão fica para a Fase 6 — e o documento não diz a
   unidade de medida, então a regra "número ≥ 10 é milímetro" seria um chute a decidir lá.
4. **Numeração composta (`1.1`, `1A`) não aparece em nenhum PDF disponível.** O caminho segue
   coberto só pelo teste unitário da sprint 5.
5. **`npm run validar` não rodou**: nenhum arquivo da aplicação foi tocado.

---

## 5. Reserva pela Groq (decisão 20) — 23/09

### 5.1 Como ficou

`Gemini` falha → `Reserva - PDF de volta` → `Extrair texto do PDF` (nativo do n8n) →
`Preparar pedido Groq` → `Groq - Extrair dados` → `Groq no formato do Gemini` → o mesmo
`Analisar e decidir`. Qualquer falha nesse caminho → `Registrar falha` → revisão, com o motivo
da Groq **e** o do Gemini. O prompt saiu do nó do Gemini e mora no `PDF para base64`, usado
pelos dois. Credential da Groq criada pelo Breno (`Zzs75Rx6S260C0Ci`). Gemini com 2
tentativas, Groq com 2.

### 5.2 A escolha do modelo — medida, não suposta

A chave enxerga 11 modelos. Testados com o prompt de produção, fora do fluxo:

| Modelo | Resultado |
|---|---|
| `qwen/qwen3.8-27b` | 16/16 no gabarito com texto do `pdftotext` — **mas o plano gratuito limita a 1.000 tokens de saída por minuto** e a proposta de 16 itens pede ~2.700. Nunca serviria para documento grande |
| `openai/gpt-oss-20b` | devolveu **18 itens** (inventou dois). Descartado |
| `openai/gpt-oss-120b` | limite de 8.000 tokens/minuto; com raciocínio padrão pediu 8.748. Com **`reasoning_effort: low` e teto de 4.500** coube: cabeçalho certo, **valor certo no banco em 16/16** itens |
| modo JSON estrito da Groq | recusou a proposta de 16 itens ("Failed to generate JSON"); o JSON é recortado da resposta |

### 5.3 Teste de ponta a ponta, com o Gemini forçado a falhar

Modelo do Gemini trocado por um inexistente só durante o teste e **restaurado logo depois**
(conferido: a versão publicada aponta para `gemini-3.6-flash`).

- **Vista Verde pela reserva:** proposta criada, `extrator: groq`, **4/4 itens iguais ao
  gabarito**, motivo do Gemini registrado. **Mas com o número errado: `CT-2026-0042`** — o
  contrato *de referência* citado no documento, não o da proposta (`PROP-2026-0117`). O Gemini
  e o Qwen acertaram. O prompt ganhou uma regra explícita para isso; **ainda não retestada**.
- **Achado — o extrator de texto do n8n embaralha PDF em duas colunas.** No `EB-25-08-0048`,
  o valor e a localização do item 6 caem dentro do 7, e os do 8 dentro do 9. Os dois modelos
  gpt-oss seguiram o texto e repetiram os itens 7 e 9. Com o `pdftotext` isso não acontece. Não
  há como trocar o extrator no n8n Cloud; a saída foi uma **trava**: número de item repetido
  (ou soma divergente) marca `itensConfiaveis: false` e o grupo recebe "itens NÃO confiáveis,
  conferir no PDF". O cabeçalho segue valendo. Testada offline (4 casos novos, 16/16).

### 5.4 Pendências nominais da reserva

1. **O n8n Cloud atingiu o limite de execuções do plano** durante o teste da proposta de 16
   itens ("Execution limit reached"). Enquanto não renovar ou o plano não mudar, **nenhum
   workflow roda — o bot inclusive**. Os testes pararam aí.
2. **A regra nova do número da proposta não foi retestada** (item 1).
3. **Pela reserva, só um documento por minuto** cabe no limite gratuito da Groq; o segundo no
   mesmo minuto vai para revisão com o erro. Documento muito grande (o contrato de 8 páginas)
   passa do limite sempre.
4. **A trava cobre repetição e soma, não troca silenciosa** entre dois itens com o mesmo total.
5. **PDF escaneado não tem reserva**: vai para revisão pedindo o PDF original.
6. **Para o Gemini real, falta o PDF de 16 itens** (a Vista Verde passou).
