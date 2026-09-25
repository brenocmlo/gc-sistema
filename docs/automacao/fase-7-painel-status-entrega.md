# Fase 7 — Painel no gc-sistema · status de entrega

> **Sem número de bloco.** Trilha da automação, lista **"OCR Contratos (WhatsApp) — Breno"**
> do ClickUp, numeração própria de 1 a 8. Ver `docs/README.md` e o `CLAUDE.md`.

Data: 2026-09-24 · Ambiente: gc-dev (`gzbmhgnpoehormnidmgg`) · Plano:
`docs/automacao/migracao-telegram-integracao-automacao.md`, Fase 7 e decisões 4, 14 e 23.

---

## Resumo

**As duas telas estão implementadas e validadas no fechamento da sprint 7 (25/09).**

Antes: `/configuracoes/contatos` e `/documentos` (listagem,
detalhe e envio pela tela). **Validação: rodou e passou** na rodada de fechamento da sprint 7
(2026-09-24), junto com ela: as sete camadas, com os passos das duas telas dentro de cada uma.
Fica fora só o envio válido pela tela, que chama o n8n de verdade (seção 4.5).

---

## 1. `/configuracoes/contatos`

O cadastro que fecha a decisão 4: a pessoa escreve ao bot, recebe o próprio código, o admin
cadastra o código aqui com a obra, e a pessoa passa a poder mandar propostas.

- **Aba nova em Configurações** (Empresa | Contatos do bot) — `configuracoes/abas.tsx`, montada
  no `layout.tsx`.
- **Tabela** com nome, código, canal e obra; contato sem obra aparece destacado.
- **Formulário em modal**, com zod no cliente e de novo na action: código do Telegram
  obrigatório (só números; aceita colado com espaço), **obra obrigatória** (sem obra, todo
  documento da pessoa iria para revisão), nome opcional.
- **Contato novo é sempre Telegram** (decisão 14). Os 2 contatos antigos de WhatsApp aparecem
  na lista como "WhatsApp (desativado)", podem ser excluídos e **não** podem ser editados — a
  edição os converteria em Telegram sem a pessoa saber.
- **Erros do banco traduzidos**: código repetido → "Esse código já está cadastrado" (o índice é
  global, não por empresa).
- **Só admin**, como o resto de Configurações. A RLS deixaria o comercial criar e editar; a
  tela e as três actions exigem admin (cada action repete a checagem).

### Migration `20260924100000_contatos_nome.sql` — aplicada em gc-dev

Acrescenta `contatos_whatsapp.nome` (opcional). Sem ela, a lista mostrava só números. Não mexe
em nada que o n8n lê. `db push` em gc-dev; `src/lib/supabase/types.ts` regerado — diff de **3
linhas** (o `nome` em Row, Insert e Update).

### Arquivos

| Arquivo | O quê |
|---|---|
| `src/lib/contatos.ts` + `contatos.test.ts` | schema, payload, identificador, rótulo de canal, tradução de erro — **11 casos** |
| `src/app/(app)/configuracoes/contatos/page.tsx` | página (consulta com JOIN de obra) |
| `…/contatos/contatos-panel.tsx` | tabela, modal, confirmação de exclusão, toasts |
| `…/contatos/actions.ts` | `createContato`, `updateContato`, `deleteContato` |
| `src/app/(app)/configuracoes/abas.tsx`, `layout.tsx` | abas de Configurações |

### Plano de validação estendido (obrigação 1)

| Script | Acréscimo |
|---|---|
| `validacao-rotas.json` | 3 rotas: admin abre com "Contatos do bot"/"Novo contato"; comercial e visualizador → 307 |
| `rotas-esperadas.txt` | `/configuracoes/contatos` (39 → 40, à mão; `--aceitar-rotas` deve reproduzir) |
| `validar-dados.mjs` | a consulta da página, copiada do `page.tsx` |
| `validar-escrita.mjs` | 9 passos: sem obra, código com letra, criação com espaço, conferência das colunas, duplicado, edição (nome vazio → nulo), WhatsApp não convertido, comercial não exclui, exclusão; limpeza no `finally` |
| `validar-navegador.mjs` | passo 25: aba, zod do cliente, criação com toast, exclusão pelo diálogo; limpeza de segurança |

## 2. Números reais

| Verificação | Resultado |
|---|---|
| `node --test src/lib/contatos.test.ts` (só este arquivo, durante o desenvolvimento) | **11/11** |
| `tsc --noEmit` | limpo |
| `next lint` nos arquivos novos | sem avisos |
| `node --check` dos 3 scripts alterados | ok |
| **`npm run validar`** (rodada de fechamento da sprint 7, 2026-09-24) | estático limpo · unitário **255 casos** · build **42 rotas** · runtime **137/137 rotas** · dados **35/35 checagens** · escrita **334/334 passos** · navegador **135/135 passos** |
| `rotas-esperadas.txt` | a linha escrita à mão bateu com o build: 42 rotas, nenhuma sumida, sem `--aceitar-rotas` |

## 3. O que não foi validado — pendências nominais

1. ~~Nenhuma das sete camadas rodou.~~ **Resolvido:** rodaram e passaram no fechamento da
   sprint 7 — as 3 rotas no runtime, a consulta na camada dados, os 9 passos de escrita e o
   passo 25 do navegador (screenshots `25-contato-invalido.png` e `25b-contato-na-tabela.png`).
2. ~~A tela não foi aberta no navegador.~~ **Resolvido:** o passo 25 abre a aba, testa o zod, cria
   pelo formulário e exclui pelo diálogo, em Chrome headless. A conferência estética dos
   screenshots não foi feita.
3. **O envio válido pela tela não roda na validação padrão** (seção 4.5).
4. **Auto-cadastro com código de vínculo** segue como melhoria, não pendência (decisão 4).
5. O script do plano foi compartilhado com a sessão da sprint 7, que acrescentou blocos no
   mesmo período; a coordenação foi por mensagem, relendo do disco antes de gravar.

---

## 4. `/documentos` — caixa de entrada e envio pela tela

Escopo do Breno em 23/09 (opção C): o que chega pelo bot **e** o que for enviado pela tela,
pela mesma leitura automática.

### 4.1 Listagem `/documentos`

Item **Documentos** no menu (admin, comercial, visualizador — os mesmos de Propostas e
Contratos). Padrão das listagens: estado na URL, busca com debounce de 300 ms, `PAGE_SIZE = 20`,
`Pagination`, período por `computePeriodoCutoff`. Colunas: recebido, tipo, número lido, obra,
valor lido, origem (Telegram / WhatsApp / Pela tela), status. Filtros: status, tipo, obra,
período; a busca é no motivo de revisão (número e valor moram no JSON da leitura, com três
formatos ao longo do tempo).

Os status ganharam nomes de gente: Processando, Faltam dados, Precisa de revisão, Registrado.
Selo próprio (`status-documento.tsx`), sem mexer no `StatusBadge` compartilhado.

### 4.2 Detalhe `/documentos/[id]`

Tipo e número lidos, origem, status, **motivo de revisão em destaque**, obra, cliente e valor
lidos, qual IA leu (Gemini ou Groq), **link para abrir o PDF** (assinatura nova de 10 minutos,
com a sessão de quem abriu — a guardada pelo bot expira) e **"Ver proposta" / "Ver contrato"**
quando o documento levou a um. Tabela dos itens como a leitura devolveu, com o aviso quando a
leitura não foi confiável e os itens não foram gravados.

### 4.3 Envio pela tela

Botão **Enviar documento** (admin e comercial): obra + PDF (até 20 MB).

1. O **navegador sobe o PDF direto** para o bucket `documentos-processamento`, na pasta
   `{empresa}/sistema/` — a policy do bucket já permitia admin e comercial. Não passa pela
   Server Action porque o limite de corpo dela é 1 MB.
2. A action `registrarEnvioDocumento` confere perfil, pasta da empresa e obra, gera a URL
   assinada de 1 ano, **grava o documento como "Processando"** (canal nulo = pela tela).
3. A action **aciona o n8n** pelo webhook `obraminds/documento`, com o token no header
   `x-documento-token`. Se o n8n não responder em 10 s — ou estiver no limite de execuções —,
   o documento **fica na lista** e a pessoa recebe o aviso.

No n8n, o `Processar Documento` ganhou a terceira porta de entrada: `Webhook - Envio pela
tela` (Header Auth, Credential `ylCphychBDVYGTBt`, responde 202 na hora). O `Normalizar entrada`
aceita `canal: SISTEMA` sem `chat_id`; o `Criar registro` virou **upsert pelo id**, então
reaproveita o documento que a action gravou em vez de criar outro. O aviso ao "cliente" é
pulado (não há conversa) e o grupo de admin é avisado como sempre. O PDF vira anexo da
proposta com o nome original.

### 4.4 Números reais

| Verificação | Resultado |
|---|---|
| `node --test src/lib/documentos.test.ts` (só este arquivo) | **11/11** |
| `tsc --noEmit` / `next lint` | limpos |
| Entrada do n8n, offline (`Normalizar entrada` + corpo do `Criar registro`) | **5/5** — tela reaproveita o documento com canal nulo, Telegram inalterado |
| `n8n_validate_workflow` | **0 erros**, 39 nós, 3 gatilhos |
| Webhook chamado sem token | **403** |

### 4.5 O que não foi validado

1. ~~Nada do `/documentos` rodou.~~ **Resolvido em parte no fechamento da sprint 7:** as 5 rotas,
   a consulta da listagem, os 8 passos de escrita e o passo 28 do navegador passaram
   (screenshots `28-documentos.png` e `28b-documento-detalhe.png`). Continua sem rodar: um envio
   válido e o webhook com token — ver o item 2.
2. **Plano estendido, com uma lacuna deliberada.** Entraram: 5 rotas (admin e comercial veem
   "Enviar documento", visualizador lê sem o botão, financeiro e produção → 307), `/documentos`
   e `/documentos/[id]` em `rotas-esperadas.txt` (40 → 42, à mão), a consulta da listagem em
   `validar-dados.mjs`, **8 passos** de escrita (upload no bucket, visualizador recusado, pasta
   de outra empresa, `..`, sem obra, obra alheia, arquivo inexistente, nenhuma recusa grava) e o
   passo 28 do navegador (menu, filtro na URL, detalhe, validação do envio). **O envio válido
   só roda com `VALIDACAO_ENVIO_REAL=1`**: ele chama o webhook do n8n de verdade, gasta execução
   e roda o Gemini num PDF de teste. Na validação padrão, o caminho feliz do envio **não é
   exercitado** — a rodada de fechamento registra "envio válido pulado". Rodar com
   `VALIDACAO_ENVIO_REAL=1` é decisão do Breno, quando o n8n tiver execução sobrando.
3. **Produção (`gc-sistema-nine`) precisa de duas variáveis novas** na Vercel:
   `N8N_DOCUMENTO_WEBHOOK_URL` e `N8N_DOCUMENTO_TOKEN` (os valores do `.env.local`). Sem elas, o
   envio registra o documento mas avisa que a leitura não foi acionada.
4. **Contrato enviado pela tela** vai para revisão, como pelo bot, até o desenho da decisão 23.
5. **Revisão humana ainda não tem ação na tela** (resolver, descartar, reprocessar). O detalhe
   mostra o motivo; o que fazer com ele é o próximo passo.

---

## 5. Validação — rodada no fechamento da sprint 7 (25/09)

O `npm run validar` do fechamento da sprint 7 (pedido do Breno, rodado pela sessão da sprint)
executou pela primeira vez os blocos desta fase. Números da rodada, conforme
`docs/sprint-7/7.6-status-entrega.md` — **incluem as duas frentes**, não só a automação:

| Camada | Resultado |
|---|---|
| unitário | **255 casos**, 0 falhas (inclui `contatos.test.ts` 11 e `documentos.test.ts` 11) |
| build | **42 rotas**, iguais à baseline (inclui `/configuracoes/contatos`, `/documentos`, `/documentos/[id]`) |
| runtime | **137/137 rotas** (inclui as 8 rotas desta fase, com os bloqueios por perfil) |
| dados | **35/35 checagens** (inclui a de contatos e a da caixa de entrada) |
| escrita | **334/334 passos** (inclui os 9 de contatos e os 8 de envio pela tela) |
| navegador | **135/135 passos**; os passos **25 (contatos) e 28 (documentos) passaram inteiros** |

Continua não validado: o envio **válido** pela tela (`VALIDACAO_ENVIO_REAL=1` não foi usado) e
qualquer execução real no n8n (limite de execuções).
