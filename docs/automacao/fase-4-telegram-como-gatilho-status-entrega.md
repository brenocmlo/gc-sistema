# Fase 4 — Telegram como gatilho do `Processar Documento` · status de entrega

> **Sem número de bloco.** Trilha da automação, lista **"OCR Contratos (WhatsApp) — Breno"**
> do ClickUp, numeração própria de 1 a 8. Ver `docs/README.md` e o `CLAUDE.md`.

Data: 2026-09-22 · Branch: `feature-dev-breno-automacao` · Ambiente: n8n Cloud
`ederbox.app.n8n.cloud` e gc-dev (`gzbmhgnpoehormnidmgg`) · Plano:
`docs/automacao/migracao-telegram-integracao-automacao.md`, Fase 4 e decisões 18 e 19.

---

## Resumo

**Construída, no ar e testada pelo Telegram até a porta da extração. Falta um passo: o
Gemini recusou por cota esgotada (429), e a proposta ainda não subiu pelo caminho completo
do Telegram.** Todas as etapas antes dele — receber, achar o contato, baixar do Telegram,
guardar no storage com nome higienizado, assinar a URL, registrar o documento e baixar de
volta — funcionaram na primeira tentativa, com um PDF real mandado pelo Breno.

O caminho da extração em diante (Gemini → proposta criada → visível na `/propostas`) **já
estava provado na Fase 2** com o mesmo workflow; o que falta é vê-lo de ponta a ponta
partindo do Telegram.

O sistema tem **2 workflows ativos**, como a decisão 19 pedia: `Notificar` e
`Processar Documento` (+ o SLA, inativo).

---

## 1. O que foi construído

Dentro do `Obraminds - Processar Documento` (`thlKSZcBPX84Y51N`), **8 nós novos**, na
frente do `Normalizar entrada`. Nenhum workflow novo.

```
Telegram Trigger → Buscar contato → Triar mensagem → Processar?
    sim → Baixar do Telegram → Guardar PDF no storage → Assinar URL → Normalizar entrada → (fluxo da Fase 2)
    não → Notificar   (resposta ao cliente)
  falha na recepção → Notificar
```

- **Gatilho no bot de produção** (`@obraminds_ingestao_v2_bot`), o mesmo que responde pelo
  `Notificar` — o cliente conversa com um bot só. O bot de teste continua disponível para
  cópias de teste do workflow no futuro, quando houver cliente real no de produção.
- **Webhook registrado** ao publicar: `allowed_updates: ["message"]`, sem erro.
- O `Execute Sub-workflow Trigger` da Fase 2 **continua** no workflow, como segunda porta de
  entrada para testes sem Telegram.
- `n8n_validate_workflow`: **0 erros, 0 warnings**, 22 nós, 2 gatilhos, 31 conexões.

### A triagem da mensagem (`Triar mensagem`)

| Mensagem | O que acontece |
|---|---|
| Vem de **grupo** (inclusive o de admin) | **ignorada** — o bot está no grupo com privacy desligado (decisão 5), e sem isso processaria toda conversa do grupo |
| De **contato não cadastrado** | responde com o próprio código (`chat_id`) para passar ao admin, e avisa o grupo `[NOVO CONTATO]` (decisão 4). Nada gravado |
| De contato cadastrado, **foto** (enviada como imagem, não como arquivo) | "Recebemos uma foto, mas por aqui aceitamos somente a proposta em PDF…" — acrescentado em 23/09 depois do teste `4212` |
| De contato cadastrado, **sem arquivo** | "Para registrar uma proposta, envie o arquivo PDF aqui nesta conversa." |
| Arquivo que **não é PDF** | "…por aqui aceitamos somente PDF…" |
| PDF **acima de 20 MB** | explica o limite (é o da API de bots do Telegram) |
| **PDF de contato cadastrado** | processa: empresa e obra saem do contato (decisões 7 e 16) |

- **Nome do arquivo higienizado** antes de ir ao storage: sem acento, e tudo que não for
  letra, número, `.`, `_` ou `-` vira `_`. Resolve o `InvalidSignature` visto na Fase 2 com
  `AL+VD`.
- **Deduplicação pelo storage**: o caminho leva o `update_id`
  (`<empresa>/telegram/<update_id>-<nome>`), e o upload é feito com `x-upsert: false`. Se o
  Telegram reentregar o mesmo update, o storage responde 409 e a reentrega é descartada em
  silêncio. Substitui o `staticData` de 200 ids do fluxo Z-API, que o plano apontava como
  frágil.
- **URL assinada de 1 ano**, gravada em `documentos_processamento.arquivo_url`, para o link
  do PDF continuar válido na revisão.
- O tipo provisório do registro passou a ser `PROPOSTA` (o canal só recebe propostas,
  decisão 18); o Gemini ainda classifica e desvia contratos.

---

## 2. Testes pelo Telegram — 2026-09-22

Feitos pelo Breno no privado do bot de produção; o monitor de execuções acompanhou.

| Execução | Mensagem | Resultado |
|---|---|---|
| `4194` | entrada do bot no grupo (mensagem de sistema) | **ignorada** |
| `4195` | `/start`, antes do cadastro | código `884349214` ao cliente + `[NOVO CONTATO]` ao grupo |
| `4196`–`4198` | três mensagens de texto **no grupo** | **ignoradas** — nenhuma resposta, nenhum registro |
| `4200` | "Oi", antes do cadastro | código ao cliente (msg 34) + aviso ao grupo (msg 35) |
| — | cadastro do contato de teste em gc-dev (código `884349214`, LC EMPRESA, `TESTE OBRA 3`) | — |
| `4203` | "Oi", **depois** do cadastro | contato **encontrado**; "envie o arquivo PDF…" entregue |
| `4212` | **foto** (23/09), contato cadastrado | caiu em "envie o arquivo PDF…" — genérico demais; **corrigido** com resposta própria para foto (seção 1) |
| `4216` | **foto** de novo, depois da correção | "Recebemos uma foto, mas por aqui aceitamos somente a proposta em PDF…" — **entregue**. Correção confirmada. (Um envio anterior não chegou ao Telegram: nenhum dos dois bots recebeu update; reenviado, chegou.) |
| `4205` | **PDF** `PROP. COM. - EF _ ADITIVOS_15 12 2025.pdf` (171 KB) | recebido, baixado do Telegram, guardado como `…/telegram/174281288-PROP._COM._-_EF_ADITIVOS_15_12_2025.pdf`, URL assinada, registro criado, PDF baixado de volta — **Gemini 429: cota esgotada**. Documento → `REVISAO_HUMANA` com o motivo; avisos ao cliente e ao grupo entregues |

---

## 3. O que NÃO foi validado — pendências nominais

1. **A proposta ainda não subiu pelo caminho completo do Telegram.** Bloqueio: **cota da
   chave do Gemini esgotada** — "You exceeded your current quota, please check your plan
   and billing details". Três saídas, decisão do Breno:
   - esperar a cota diária renovar (plano gratuito: meia-noite do Pacífico, ~04:00 de
     Brasília) e mandar o PDF de novo;
   - **ativar faturamento** no projeto Google da chave — o recomendado para produção, porque
     o limite gratuito trava a entrada num dia de muitas propostas;
   - trocar a chave na Credential `Gemini — extração de documentos` (o ID não muda).

   Consumo: ~12 extrações de teste no dia, e cada falha tentava até 5 vezes. As tentativas
   caíram para **3, com 5 s entre elas** (5 s é o máximo do n8n) — retry ajuda no 503 de
   pico, mas não na cota esgotada.
2. **Arquivo não-PDF enviado *como arquivo* e arquivo acima de 20 MB** não foram exercitados.
   O teste `4212` mandou uma **foto** — que o Telegram entrega fora de `document`, comprimida —
   e expôs um buraco: a foto caía em "envie o PDF", resposta genérica para quem acabou de
   mandar algo. Corrigido com resposta própria para foto — **confirmado no teste `4216`**. Imagem
   enviada *como arquivo* (não-PDF) continua não exercitada.
3. **A deduplicação por 409 não foi exercitada** — exigiria o Telegram reentregar um update.
4. **A tela `/propostas` não foi aberta** (mesma pendência da Fase 2).
5. **Dados de teste em gc-dev ainda presentes**, de propósito, para o reteste: o contato
   Telegram do Breno (`382c8844…`), o documento `a8153945…` em `REVISAO_HUMANA` e o PDF no
   storage. Saem na limpeza, depois do reteste.
6. **`/configuracoes/contatos` ainda não tem o campo `telegram_chat_id`.** O cadastro de teste
   foi feito por SQL. A mensagem do bot manda o admin cadastrar "em Configurações →
   Contatos", o que hoje não é possível pela tela — é a Fase 7.
7. **Cada mensagem de contato desconhecido avisa o grupo de novo.** Não há memória de "já
   avisei este código". Aceitável enquanto o volume for baixo.
8. **`npm run validar` não rodou nesta fase**: nenhum arquivo da aplicação foi tocado.
