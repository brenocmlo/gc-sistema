# Fase 6 — Rota de ingestão no gc-sistema · status de entrega

> **Sem número de bloco.** Trilha da automação, lista **"OCR Contratos (WhatsApp) — Breno"**
> do ClickUp, numeração própria de 1 a 8. Ver `docs/README.md` e o `CLAUDE.md`.

Data: 2026-09-23 · Branch: `feature-dev-breno-automacao` · Plano:
`docs/automacao/migracao-telegram-integracao-automacao.md`, Fase 6 e decisões 1, 9 a 12, 16.

---

## Resumo

**Em andamento. O código está escrito e testado — 21/21 testes unitários, `tsc` limpo — mas
ainda FORA do repositório**, em `/Users/a1234/gc-sistema-staging/fase-6/`. Duas coisas
seguram a entrada:

1. **A sessão da sprint 5 está ativa no mesmo working tree** (fechando a 5.7, pelo chat
   "sprints e click up"). Uma rota nova em `src/app/api/` faria a camada build dela
   **reprovar** — o `validar.sh` compara a lista de rotas com `scripts/rotas-esperadas.txt` —
   e um teste novo em `src/lib/` mudaria a contagem que ela está registrando. Os arquivos que
   esta fase precisa estender (`validar-escrita.mjs`, `rotas-esperadas.txt`,
   `validacao-rotas.json`) estão com mudança não commitada dela.
2. **Não há endereço público do gc-sistema apontando para o gc-dev.** O n8n roda na nuvem e
   não alcança um `next dev` local; o único deploy é o da Vercel, que aponta para gc-prod
   (fora do escopo) e tem login da Vercel na frente. Isso segura a troca do REST direto do
   n8n pela rota — não a rota em si, que se testa inteira por HTTP local.

**`npm run validar` não rodou** e a fase **não está concluída**.

---

## 1. O que está no rascunho

```
/Users/a1234/gc-sistema-staging/fase-6/
  src/lib/ingestao.ts                         helper puro (regra)
  src/lib/ingestao.test.ts                    21 casos de node --test
  src/app/api/ingestao/proposta/route.ts      route handler
  patches/middleware.patch                    exceção de /api/ingestao/ no middleware
  src/lib/{itens,propostas,historico,types}.ts → symlinks para o repo
```

Os symlinks fazem o teste rodar contra o código **real** da sprint 5, não uma cópia.

### `src/lib/ingestao.ts` — a regra

Reusa, sem duplicar: `resolverValorUnit`, `notaDeInferencia`, `normalizarUnidade`,
`numeroItemDoDocumento`, `acrescentarObservacao` e `limparColunasGeradas` (sprint 5,
`itens.ts`); `validarDesconto`, `validarSomaPct`, `pctToFraction` e
`novaEntradaHistoricoProposta` (`propostas.ts`).

| Regra | Onde |
|---|---|
| `valor_unit` ausente → inferido de total / quantidade, nota em `observacao` (decisão 10) | `montarItemIngestao` |
| Sem nenhum dos dois valores, ou quantidade nula/zero → **recusa** (decisão 10) | idem |
| Unidade → `QTD`/`M2`; original não reconhecido em `observacao` (decisão 11) | idem |
| `numero` não inteiro → `null`, original em `observacao` | idem |
| `numero` repetido no documento → o segundo vira `null`, com nota (`unique (proposta_id, numero)`) | `montarIngestao` |
| **Nunca** monta `valor_total` nem `area_m2` (colunas geradas) | `limparColunasGeradas` |
| Unitário × quantidade ≠ total impresso → grava o unitário, registra o total impresso | `montarItemIngestao` |
| Largura/altura acima de 10 lidas como **milímetro** → metros, original em `observacao` | `dimensaoEmMetros` |
| Um item sem conserto **recusa a ingestão inteira** — nada de proposta meio gravada | `montarIngestao` |
| Proposta nasce **`rascunho`**, `created_by` = profile de serviço | idem |
| **Histórico desde o nascimento**: `de: rascunho, para: rascunho`, `por` = **uuid** (decisão 12) | idem |
| Rastro do documento: `[automação · TELEGRAM · documento <id>]` em `observacao` | idem |
| Soma dos itens ≠ total do documento (>1%) → **aviso**, não recusa (o trigger da 5.6 faz o valor virar a soma) | idem |
| Token conferido em tempo constante | `tokenConfere` |

**Por que o rastro vai em `observacao`:** a entrada de `historico` tem campos fixos
(`de, para, em, por, motivo_rejeicao, detalhe_rejeicao`) e não comporta o `documentoId`. O
vínculo forte continua sendo `documentos_processamento.proposta_criada_id`.

### `route.ts` — a fronteira

`POST /api/ingestao/proposta`, header `x-ingestao-token`. Sem sessão não há RLS de usuário:
a rota usa a service role e **confere ela mesma** documento × empresa e obra × empresa antes
de gravar.

| Resposta | Quando |
|---|---|
| `201 { ok, propostaId, itens, avisos }` | criou proposta, itens, e vinculou o documento (`APROVADO`, `proposta_criada_id`) |
| `200 { ok, propostaId, jaExistia: true }` | o documento já tinha gerado proposta — o n8n reexecutou |
| `401` | token errado |
| `409` | número de proposta repetido na empresa (decisão 9), com a mensagem de `mensagemDeErroProposta` |
| `422` | payload recusado pela regra, documento ou obra de outra empresa, ou itens recusados pelo banco |
| `500` | rota sem configuração (`INGESTAO_TOKEN`, `INGESTAO_PROFILE_ID`, URL, service role) |

**Proposta e itens na mesma unidade:** se o insert dos itens falhar, a proposta é
**apagada** antes de responder. A rota também passa a fazer o vínculo do documento, que hoje é
um nó separado no n8n — com ela, o `Processar Documento` troca dois nós (`Criar proposta` e
`Documento aprovado`) por uma chamada.

### `middleware.patch`

O middleware atual redireciona para `/login` **toda** requisição sem sessão, inclusive
`/api/*`. A exceção deixa passar só o prefixo `/api/ingestao/`; a proteção é o token.

---

## 2. Números reais

| Verificação | Resultado |
|---|---|
| `node --test src/lib/ingestao.test.ts` (no rascunho, contra os helpers reais) | **21 casos, 21 pass, 0 falhas** |
| `tsc --noEmit` do rascunho, contra o `Database` gerado e as dependências do repo | **limpo** |
| Caso real: PDF `EB-25-08-0048` | 16 itens, numeração 1–16, **7 inferidos**, item 13 em 0,95 × 2,1 m, item 7 com o total impresso anotado, soma 120.656,19 (0,8% abaixo, sem aviso) |

---

## 3. O que falta — pendências nominais

1. **Entrar no repositório**, quando a sessão da sprint 5 parar: copiar os três arquivos,
   aplicar o patch do middleware, criar `INGESTAO_TOKEN` no `.env.local`.
2. **Obrigações de validação do plano, todas por fazer:**
   - `bash scripts/validar.sh build --aceitar-rotas` (rota nova);
   - a rota **fora** de `scripts/validacao-rotas.json` — autentica por token e devolve 401/405,
     não 307 para `/login`; a regra 3 do `CLAUDE.md` pede listar isso nominalmente;
   - passos novos em `scripts/validar-escrita.mjs`: ingestão feliz com itens, pct > 100%,
     número duplicado (409), obra de outra empresa, token errado (401), segunda chamada com o
     mesmo `documentoId` (200 e mesmo id), item só com total (unitário inferido), `UN` → `QTD`,
     quantidade zero recusada — **com limpeza**;
   - `npm run validar` inteiro, números no documento.
3. **Endereço público apontando para o gc-dev** para o n8n chamar a rota. Decisão do Breno;
   caminhos em aberto:
   - um deploy de preview da Vercel com as variáveis do **gc-dev** e o *Protection Bypass for
     Automation* (header que libera máquina sem login) — exige push da branch, que só com
     pedido explícito;
   - um túnel temporário do `next dev` local só durante os testes;
   - manter o REST direto no n8n até existir o ambiente, e deixar a rota pronta.
4. **Trocar no `Processar Documento`** `Criar proposta` + `Documento aprovado` pela chamada à
   rota, com o token numa Credential. Depende do item 3.
5. **Regra de milímetro é heurística.** Documento com esquadria de mais de 10 m, ou que
   escreva em centímetros, vai ser lido errado — o original fica em `observacao`.
