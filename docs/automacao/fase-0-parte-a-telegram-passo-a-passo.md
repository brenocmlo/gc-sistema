# Fase 0, Parte A — criar os bots e o grupo no Telegram, passo a passo

Plano: `docs/automacao/migracao-telegram-integracao-automacao.md`, Fase 0.
Runbook resumido: `docs/automacao/fase-0-runbook.md`, Parte A.
Decisões que valem aqui: **4** (cadastro manual de `chat_id`), **5** (destino de admin é um
grupo), **7** (um bot para todas as empresas).

Este arquivo é a versão executável da Parte A: **dez passos, na ordem em que têm de ser
feitos**, tudo no app do Telegram mais um endereço no navegador. Leva ~15 minutos.

> **Nenhum token entra neste arquivo.** Os tokens que você vai gerar aqui não vão para
> documento, commit ou log — vão direto para as Credentials do n8n, na Parte B.

---

## Grupo ou individual? Os dois — e não é a mesma coisa

Esta é a dúvida que mais atrapalha na hora de montar, então vem antes dos passos.

| | **Conversa privada** (individual) | **Grupo** |
|---|---|---|
| Quem fala ali | cada pessoa que manda documento — cliente, você | ninguém manda documento; só o bot escreve |
| Para que serve | **entrada**: é por onde o contrato/proposta chega (Fase 4) | **saída**: é para onde vai a notificação de admin (Fase 2) |
| `chat_id` | **positivo** (ex.: `123456789`) | **negativo** (ex.: `-1001234567890`) |
| Quantos existem | um por pessoa cadastrada | **um só**, para toda a operação |
| Onde o número fica guardado | tabela `contatos_whatsapp`, cadastrado pelo admin (decisão 4) | um único nó do `Notificar` (decisão 5) |

Em uma frase: **o documento entra pelo privado, o aviso sai no grupo.**

O grupo existe para resolver "quem são os admins" sem redeploy — entra e sai gente do grupo e
pronto. É ele que substitui os ~12 lugares onde hoje está escrito `558598202307` na mão.

**Você vai criar um grupo só.** Não é um grupo por empresa: decisão 7 é um bot para todas as
empresas, e o `empresa_id` sai do `chat_id` de quem mandou, não do grupo.

---

## Por que a ordem importa

Três dos passos abaixo quebram se forem feitos fora de ordem — e o passo 4 existe para
nenhum dos três ser depurado com um token errado no meio:

1. **Privacy mode antes de adicionar o bot ao grupo.** Mudar o privacy mode **não afeta
   grupos em que o bot já está**. Se você adicionar primeiro e desligar depois, tem de
   remover e re-adicionar o bot.
2. **Pegar os `chat_id` antes da Parte B.** A Parte B registra um webhook no bot. Com webhook
   registrado, o `getUpdates` para de funcionar e passa a devolver erro `409 Conflict`. Os
   passos 8 e 9 têm de acontecer **antes** de eu cadastrar as Credentials.
3. **Mandar a mensagem depois de adicionar o bot.** O `getUpdates` só enxerga o que aconteceu
   depois de o bot entrar — e guarda por ~24 h.

---

## Antes de começar

- [ ] Telegram instalado, na conta que vai administrar isso
- [ ] um navegador à mão (pode ser o do celular)
- [ ] um lugar seguro para colar dois tokens **temporariamente** — gerenciador de senhas ou
      rascunho que você apaga depois. **Não** é o WhatsApp, não é um `.md`, não é o chat.

---

## Passo 1 — abrir o BotFather

No Telegram, busque **`@BotFather`** e abra a conversa. Confira o **selo azul de verificado**
— existem imitações. Toque em **Iniciar** / `/start`.

Ele responde com a lista de comandos. É por aqui que tudo é feito.

---

## Passo 2 — criar o bot de TESTE

Mande:

```
/newbot
```

Ele pergunta duas coisas, uma de cada vez:

1. **Nome** (aparece no topo da conversa, pode ter espaço e acento):

   ```
   ObraMinds Ingestão (teste)
   ```

2. **Username** (o `@`, é único no Telegram inteiro e **tem de terminar em `bot`**):

   ```
   obraminds_ingestao_teste_bot
   ```

Se responder **"Sorry, this username is already taken"**, o nome já é de outra pessoa — não
tem como negociar. Acrescente algo e tente de novo: `obraminds_ingestao_teste2_bot`,
`obraminds_ing_teste_bot`. O username não precisa ser bonito, ninguém digita ele.

Deu certo, ele responde **"Done! Congratulations on your new bot"** e mostra:

```
Use this token to access the HTTP API:
1234567890:AAH_exemplo_nao_use_isto_aqui
```

**Guarde esse token.** É o token de **teste**.

---

## Passo 3 — criar o bot de PRODUÇÃO

Mande `/newbot` de novo e repita o passo 2 com:

| | Nome | Username |
|---|---|---|
| Produção | `ObraMinds Ingestão` | `obraminds_ingestao_bot` |

**Guarde o segundo token.** É o de **produção**.

> **Por que dois bots.** Um token do Telegram aceita **um** webhook, e só um. Se você testar
> usando o bot de produção, o teste derruba o webhook que está atendendo cliente naquele
> momento — e ninguém percebe até alguém reclamar que mandou contrato e não voltou nada.
> Dois bots é o que torna seguro testar às 14h de uma terça.

Neste ponto você tem **dois tokens diferentes**. Confira que são diferentes — é comum copiar
o mesmo duas vezes. Os números antes dos `:` não podem ser iguais.

---

## Passo 4 — conferir que os dois tokens funcionam

**Faça isto antes de seguir.** É trinta segundos e evita descobrir um token errado três
passos depois, quando já tem grupo e bot no meio e fica difícil saber o que quebrou.

No navegador, trocando `<TOKEN>` pelo token do bot de **teste**:

```
https://api.telegram.org/bot<TOKEN>/getMe
```

**Token certo** devolve os dados do bot:

```json
{"ok":true,"result":{"id":1234567890,"is_bot":true,
 "first_name":"ObraMinds Ingestão (teste)","username":"obraminds_ingestao_teste_bot"}}
```

Confira o `username` — é o jeito de saber que você está testando o bot que pensa que está,
e não o outro.

**Token errado** devolve:

```json
{"ok":false,"error_code":401,"description":"Unauthorized"}
```

`401` quer dizer **o token da URL está errado** — só isso. Não é o grupo, não é o privacy
mode, não é o bot. Percorra nesta ordem:

| Conferir | Como é o certo |
|---|---|
| Sobrou `<` ou `>` na URL? | o `<TOKEN>` do exemplo é lugar reservado — os sinais **saem** junto |
| A palavra `bot` está colada? | `.../bot1234567890:AAH.../getMe`, sem espaço, sem barra entre `bot` e o número |
| Tem **um** `:` só? | um, entre o número e o resto |
| Tem espaço, quebra de linha ou `…` no meio? | não pode ter nenhum — copiar à mão costuma cortar o fim |
| Copiou o token, e não o username? | token começa com número, tem `:`, e uns 46 caracteres |
| Copiou do bot certo? | veja o `username` que o `getMe` devolve |

**O jeito de copiar sem errar:** no BotFather mande `/mybots` → escolha o bot → **API
Token**. Ele reenvia o token em bloco de código; **toque nele e copia inteiro**. Selecionar
com o dedo é o que mais corta caractere.

Deu `ok:true` nos dois tokens? Siga. Se um deles insistir no 401 depois dessa lista, me
avise — não use `/revoke`, porque isso invalida o token e cria um terceiro para controlar.

---

## Passo 5 — desligar o privacy mode nos dois

Ainda no BotFather:

```
/setprivacy
```

1. Ele lista seus bots — escolha o de **teste**.
2. Ele explica a opção e mostra um teclado com **Enable / Disable**. **Toque no botão
   `Disable`.**
3. Ele confirma: **`Success! The new status is: DISABLED.`**

**Repita para o bot de produção.** Mande `/setprivacy` de novo e escolha o outro.

> **Toque no botão, não digite a palavra.** Digitar `disable` como texto faz o BotFather
> responder **`Success!` mesmo assim** — mas com o status **errado**:
> `Success! The new status is: ENABLED.` Como a mensagem começa com "Success", é fácil ler
> como se tivesse dado certo e seguir com o bot ainda ligado.
>
> **Leia sempre a última palavra da confirmação.** A única que serve é `DISABLED`.

**Para conferir depois, sem alterar nada:** `/mybots` → escolha o bot → **Bot Settings** →
**Group Privacy**. Faça isso nos **dois** antes de seguir para o grupo.

Como ler essa tela: **o botão oferece a ação contrária ao estado atual.** O que você quer ver
é `Privacy mode is disabled for ...` com o botão **`Turn on`** — botão "Turn on" quer dizer
que **está desligado**, que é o certo. Se o botão for **`Turn off`**, o privacy ainda está
ligado; toque nele. E confira o `@username` na mensagem, para não conferir o mesmo bot duas
vezes achando que viu os dois.

> **O que isso muda, na prática.** Com privacy mode **ligado** (o padrão), dentro de um grupo
> o bot só recebe mensagem que seja comando (`/algo`), menção a ele, ou resposta a uma
> mensagem dele — o resto da conversa ele não enxerga. Como o destino de admin é um grupo
> (decisão 5), e no passo 8 você precisa que ele veja uma mensagem qualquer para o `chat_id`
> aparecer, **isso não é opcional**.
>
> Lembrando o que está lá em cima: faça isso **agora**, antes do grupo existir. Em grupo onde
> o bot já entrou, a mudança não vale até ele ser removido e adicionado de novo.

---

## Passo 6 — criar o grupo de admin

No Telegram: **Nova mensagem → Novo grupo**.

- **Nome sugerido:** `ObraMinds · Automação`
- **Quem entra:** as pessoas que devem receber notificação de erro e de proposta registrada.

Crie o grupo com as pessoas primeiro. Os bots entram no passo 7.

---

## Passo 7 — adicionar os dois bots ao grupo

Abra o grupo → nome do grupo no topo → **Adicionar membros** → busque pelo username
(`obraminds_ingestao_teste_bot`) → adicione. **Repita para o de produção.**

Os dois ficam no mesmo grupo. O de teste está ali para você conseguir testar notificação sem
usar o de produção.

**Não precisa promover a administrador.** Para escrever no grupo, basta ser membro. Promover
só seria necessário para tipos de update que não vamos usar.

---

## Passo 8 — pegar o `chat_id` do GRUPO

1. **Mande qualquer mensagem no grupo.** Um `oi` serve. Isto é o que cria o update que você
   vai ler — sem isso a resposta vem vazia.

2. No navegador, abra este endereço trocando `<TOKEN>` pelo token do **bot de teste**:

   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```

   Repare que é `bot` colado no token: `https://api.telegram.org/bot1234567890:AAH.../getUpdates`.

3. Vem um JSON. Procure o trecho `"chat"`:

   ```json
   "chat": {
     "id": -1001234567890,
     "title": "ObraMinds · Automação",
     "type": "supergroup"
   }
   ```

   **O `id` do grupo é negativo.** Não é erro, e **o sinal de menos faz parte do valor** —
   `-1001234567890` e `1001234567890` são coisas diferentes. Copie com o menos.

   Confira o `"title"` para ter certeza de que é o grupo certo, e não a sua conversa privada.

> **O `chat_id` é do grupo, não do bot.** Qualquer bot que esteja lá dentro lê o mesmo
> número, e ele serve para os dois. Por isso este passo usa o token do bot de **teste** — é
> o que já está com privacy desligado desde antes de o grupo existir. Não precisa do bot de
> produção aqui.

**Se vier `{"ok":true,"result":[]}`** (lista vazia): o token está certo — `ok:true` prova
isso — mas não há nada na fila **deste** bot. Três causas, nesta ordem:

1. ninguém mandou mensagem no grupo **depois** de o bot entrar;
2. o bot estava com **privacy mode ligado** quando a mensagem foi mandada, e não a enxergou —
   mensagem antiga não volta, mesmo depois de desligar o privacy;
3. já passou de ~24 h.

Nos três casos a saída é a mesma: **mande uma mensagem nova no grupo e recarregue.**

**Se vier erro `409 Conflict`**: já existe webhook registrado nesse token — quer dizer que a
Parte B já rodou. Me avise em vez de mexer.

---

## Passo 9 — pegar o SEU `chat_id` pessoal

1. Busque o seu bot de teste pelo username e abra a conversa **no privado**.
2. Mande `/start`.
3. Abra o mesmo endereço do passo 8 e procure o `"chat"` **com `"type": "private"`**:

   ```json
   "chat": { "id": 123456789, "first_name": "Breno", "type": "private" }
   ```

   **Esse é positivo.** É o seu.

Para que serve: é com ele que você vai se cadastrar como primeiro contato na Fase 7, e é ele
que deixa testar a ingestão da Fase 4 sem envolver cliente nenhum.

---

## Passo 10 — guardar o `chat_id` do grupo

Enquanto a Fase 2 (`Notificar`) não existe, o número do grupo fica no `.env.local`, que **não
é versionado**, só para não se perder:

```
TELEGRAM_ADMIN_CHAT_ID=-1001234567890
```

Os **tokens não vão para o `.env.local`** — eles vão para as Credentials do n8n, que é a
Parte B, e é comigo.

---

## Ao fim da Parte A você tem

- [ ] token do bot de **teste** (guardado fora de documento)
- [ ] token do bot de **produção** (guardado fora de documento)
- [ ] os dois tokens conferidos como **diferentes** entre si
- [ ] privacy mode **DISABLED** nos dois, feito **antes** de entrarem no grupo
- [ ] grupo `ObraMinds · Automação` criado, com as pessoas e **os dois bots**
- [ ] `chat_id` do grupo, **negativo**, copiado com o sinal
- [ ] seu `chat_id` pessoal, **positivo**
- [ ] `TELEGRAM_ADMIN_CHAT_ID` no `.env.local`

Me passe **os dois tokens** e eu sigo com a Parte B: as duas Credentials "Telegram API", o
workflow descartável com Telegram Trigger e a conferência do webhook.

---

## Armadilhas conhecidas

| Sintoma | Causa | O que fazer |
|---|---|---|
| `getUpdates` devolve `result: []` | nenhuma mensagem depois de o bot entrar, ou passou de ~24 h | mande mensagem no grupo e recarregue |
| `getUpdates` devolve `409 Conflict` | já tem webhook nesse token | a Parte B já rodou — me avise |
| `401 Unauthorized` | o token da URL está errado — sobrou `<>`, faltou pedaço, sobrou espaço, ou é o bot errado | rode a tabela do **passo 4**; recopie por `/mybots` → **API Token** |
| `404` | faltou o `bot` colado no token na URL | `.../bot<TOKEN>/getUpdates` |
| O bot não vê mensagem do grupo | privacy mode ainda ligado nesse grupo | `/setprivacy` → **botão** Disable, **e** remova e re-adicione o bot |
| No grupo só chega a mensagem que **menciona** o bot (`@...`), e o `oi` some | privacy mode ligado. **Bot recriado nasce com ENABLED** — a configuração é por bot e não se herda | `/setprivacy` → botão Disable **nos dois bots novos**, depois remova e re-adicione ao grupo |
| BotFather respondeu `Success!` mas o privacy continua ligado | a palavra `disable` foi digitada em vez de tocada no botão — a confirmação vem `Success! The new status is: ENABLED.` | refaça tocando no botão; confira em `/mybots` → Bot Settings → Group Privacy |
| Só aparece a conversa privada no `getUpdates` | o bot não está no grupo, ou ninguém falou lá depois | confira que ele é membro e mande outra mensagem |
| "Sorry, this username is already taken" | username é único no Telegram todo | escolha outro; ninguém digita ele |
| O `chat_id` do grupo mudou sozinho | o grupo virou **supergrupo** (acontece ao crescer ou mudar config) e o id passa a começar com `-100` | pegue o número de novo pelo passo 8 e atualize o `.env.local` |

## O que a Parte A **não** faz

Não cadastra Credential, não cria workflow, não mexe em nenhum dos workflows que já existem.
Se algum passo aqui pedir para você abrir o n8n, o passo está errado — o n8n é a Parte B.
