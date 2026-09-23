# Fase 0 — runbook: bots, credenciais e grupo de admin

Plano: `docs/automacao/migracao-telegram-integracao-automacao.md`, Fase 0.
Decisões que valem aqui: **5** (grupo de admin), **7** (um bot para todas as empresas),
**13** (`n8n-mcp` no escopo do gc-sistema).

> **Por que esta fase não roda na sessão da Fase 1.** Dois motivos independentes:
>
> 1. **Ferramenta.** O `n8n-mcp` foi acrescentado ao escopo do gc-sistema em 2026-09-21, mas
>    servidor MCP carrega na inicialização da sessão — a sessão que fez a Fase 1 continua sem
>    nenhuma ferramenta `n8n_*`. **Abrir uma sessão nova resolve.**
> 2. **Natureza.** Criar bot no BotFather, criar grupo no Telegram e desligar privacy mode
>    são ações no app do Telegram, feitas por uma pessoa. Nenhum agente faz isso.
>
> Então a Fase 0 é: **você faz a parte A**, e a sessão nova faz a **parte B**.

---

## Parte A — o que só você pode fazer (Telegram, ~10 min)

### A1. Criar os dois bots

No Telegram, fale com **@BotFather**:

```
/newbot
```

Ele pede nome e username. Faça **duas vezes**:

| | Nome sugerido | Username (tem de terminar em `bot`) |
|---|---|---|
| Teste | `ObraMinds Ingestão (teste)` | `obraminds_ingestao_teste_bot` |
| Produção | `ObraMinds Ingestão` | `obraminds_ingestao_bot` |

**Por que dois:** um token do Telegram admite **um** webhook. Testar com o bot de produção
derruba o webhook ativo no meio do expediente.

Cada `/newbot` devolve um token no formato `1234567890:AA...`. **Guarde os dois** — eles não
vão neste arquivo nem em nenhum documento versionado.

### A2. Desligar o privacy mode nos dois

Ainda no BotFather:

```
/setprivacy
```

Escolha o bot → **Disable**. Repita para o outro.

**Não é opcional** (decisão 5): com privacy mode ligado, o bot não enxerga mensagens de
grupo, e o destino das notificações de admin é um grupo.

### A3. Criar o grupo de admin e pegar o `chat_id`

1. Crie um grupo no Telegram — sugestão de nome: **ObraMinds · Automação**.
2. Adicione **os dois bots** e as pessoas que devem receber notificação.
3. Mande qualquer mensagem no grupo.
4. Pegue o `chat_id`: abra no navegador, trocando `<TOKEN>` pelo token do bot de teste:

   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```

   Procure `"chat":{"id":-100...}`. **O id de grupo é negativo** — isso é normal, não é erro,
   e o sinal faz parte do valor.

### A4. Descobrir o seu próprio `chat_id`

Fale com o bot de teste no privado (mande `/start`) e rode o mesmo `getUpdates`. O `chat_id`
positivo que aparecer é o seu. Serve para cadastrar o primeiro contato na Fase 7 e para
testar a Fase 4 sem envolver cliente.

### Ao fim da parte A você tem

- [ ] token do bot de **teste**
- [ ] token do bot de **produção**
- [ ] `chat_id` do **grupo de admin** (negativo)
- [ ] seu `chat_id` pessoal (positivo)
- [ ] privacy mode **Disable** nos dois

---

## Parte B — o que a sessão nova faz

Abra uma sessão do Claude Code **em `/Users/a1234/gc-sistema`** e cole o prompt de
`docs/automacao/fase-0-prompt-sessao-nova.md`.

A primeira coisa que ela deve fazer é **confirmar que tem ferramenta `n8n_*`**. Se não tiver,
o `.mcp.json`/`~/.claude.json` não carregou e não adianta seguir.

Depois:

1. **Cadastrar os dois tokens como Credential "Telegram API"** no n8n — uma por bot.
   **Nenhum token em nó HTTP**, e nenhum token em documento.
2. **Workflow descartável** com Telegram Trigger, só para provar que a mensagem chega e o
   `chat_id` aparece no log.
3. **Conferir o comportamento do Telegram Trigger em n8n Cloud**: URL de teste e de produção
   são distintas, e ativar/desativar o workflow re-registra o webhook. Saber disso antes
   evita depurar "o bot não responde" por uma hora.
4. **Fechar a decisão 6**, que ficou aberta na Fase 1 e não é da Fase 0, mas depende da mesma
   ferramenta: abrir o `dOt8aiCX2OCr08RH` (Integração Oficial — Contrato) e ver **qual status
   ele escreve em `documentos_processamento` ao registrar um contrato**.
   - Se for `APROVADO` → a proposta usa `APROVADO` também, com `proposta_criada_id`
     preenchido, e **o CHECK não muda**.
   - Se for outro valor que também não está no CHECK → **pare e avise**: significa que os
     dois fluxos estão quebrados, e o conserto é maior que esta fase.
   - Registre o achado, inclusive se o update vinha falhando com erro ou em silêncio.

### Onde guardar os segredos

| Item | Onde | Onde **não** |
|---|---|---|
| Tokens dos bots | Credential do n8n | nó HTTP, `.md`, commit, log |
| `chat_id` do grupo | um único nó do `Notificar` (Fase 2) | espalhado em 12 nós, como o `558598202307` de hoje |

Até a Fase 2 existir, o `chat_id` do grupo pode ficar no `.env.local` (não versionado) como
`TELEGRAM_ADMIN_CHAT_ID`, só para não se perder.

---

## Aceite da Fase 0

- [ ] os dois bots respondem `/start`
- [ ] os dois estão no grupo de admin, com privacy mode desligado
- [ ] as duas Credentials existem no n8n
- [ ] um workflow descartável com Telegram Trigger recebe mensagem e mostra o `chat_id` no log
- [ ] o `chat_id` do grupo está anotado em um lugar só
- [ ] decisão 6 fechada e registrada

## O que a Fase 0 **não** faz

Não cria o `Notificar` (Fase 2), não mexe em nenhum dos 7 workflows existentes (Fase 3), não
cria a ingestão por Telegram (Fase 4). Se a sessão nova começar a editar workflow de
produção, ela saiu do escopo.
