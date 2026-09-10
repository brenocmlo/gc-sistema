# Correções nas listagens e no cálculo de valores de obra

Data: 2026-09-05. Branch: feature-dev-breno-automacao. Working tree, sem commit.

## De onde isto veio

O documento do bloco 4.3 registrava três caminhos entregues sem nunca terem
rodado: o EmptyState sem registros, a paginação acima de 20 e a visão de outro
perfil. Fechar dois deles expôs **dois bugs em produção-equivalente** que
nenhuma camada de validação pegava, e um terceiro no próprio validador.

É o argumento do plano de validação em forma de exemplo: os dois bugs estavam
em telas dadas como prontas há semanas, passando por `tsc`, `lint` e
`next build` sem reclamação.

## Bug 1: página fora do alcance mostra erro de banco

**Sintoma.** `/propostas?page=99` — ou qualquer página depois da última — não
mostrava lista vazia: mostrava a faixa vermelha "Erro ao carregar propostas:".
Acontecia nas cinco listagens (propostas, orçamentos, FD, obras, clientes).

**Causa.** O PostgREST recusa um `range` que começa depois do último registro,
com HTTP 416 e código `PGRST103`, em vez de devolver lista vazia. E **não manda
o `count` junto**, então a tela não tem como se recompor sozinha.

Não é caso hipotético: basta um link velho, um favorito, ou estar na página 2 e
alguém apagar registros.

**Correção.** `isRangeForaDoAlcance` e `urlSemPagina`, em `src/lib/listagem.ts`,
com teste. Cada listagem, ao receber esse erro em página maior que 1,
redireciona para a primeira página **preservando os filtros** — perder a busca
junto seria pior que perder a página.

Volta pra primeira e não pra última de propósito: descobrir a última exigiria
uma segunda consulta com os mesmos filtros, e este é o caminho raro.

## Bug 2: /obras quebrada por ambiguidade em calcular_valores_obra

**Sintoma.** Toda a listagem `/obras` mostrava a faixa vermelha em gc-dev.
Qualquer `select` em `obras_com_valores` falhava com
`42702: column reference "valor_total" is ambiguous`.

**Causa.** A função `calcular_valores_obra` declara parâmetros OUT chamados
`valor_total`, `desconto`, `pct_*`. Dentro do corpo, as CTEs `c_vigentes` e
`todos` selecionavam essas colunas **sem qualificar**. Em plpgsql isso é
ambíguo entre a coluna da tabela e o parâmetro de saída, e o Postgres recusa.

Dois detalhes que explicam por que sobreviveu tanto tempo:

1. **O erro é dormente.** Só dispara no ramo em que a obra tem contrato vigente
   ou proposta aprovada. Obra sem nenhum dos dois cai no CASO 2 e passa. A
   migration 006, que consertou justamente o CASO 2, não tinha como expor isso.
2. **Uma obra derruba a tela inteira.** A view chama a função via `LATERAL`, uma
   vez por linha. Em gc-dev, `OBRA-2025-03` tem 3 contratos ativos — e a
   listagem inteira caía por causa dela.
3. **Eram três superfícies, não uma.** Quem lê `obras_com_valores` é a listagem
   `/obras`, o detalhe `/obras/[id]` e a exportação `/api/export/obras`. As três
   estavam quebradas, e só a listagem tinha rota na validação. As outras duas
   entraram depois — o detalhe com o placeholder `{obraPrimeira}`, e a
   exportação com asserção de `content-type`, já que rota de API não devolve
   HTML.

**E ia piorar com o bloco 4.6:** aprovar uma proposta pela tela passou a ser
possível, e proposta aprovada ativa o mesmo ramo. Ou seja, a primeira aprovação
feita pela interface derrubaria `/obras`.

**Correção.** Migration `20260905190000_fix_calcular_valores_obra_ambiguidade.sql`,
que só qualifica as referências (alias em cada `from`, prefixo em cada coluna).
A lógica é idêntica à da 006. Depois do push, as três obras calculam:
`OBRA-2025-03` volta `fonte=contratos`, R$ 364.968,57.

## Bug 3: o validador mentia sobre a causa

**Sintoma.** A camada runtime falhava com "servidor não subiu" enquanto o log do
Next dizia "Ready in 533ms".

**Causa.** Duas, somadas. O `next dev` que rodei pra depurar **sobrescreve** o
`.next` de produção, e aí o `next start` sobe e devolve 500 em toda rota. E a
checagem de prontidão usava `curl -sf`, que trata 500 como falha de conexão —
"não respondeu" e "respondeu errado" viravam a mesma mensagem.

**Correção.** O `validar.sh` agora espera qualquer resposta HTTP, checa se
`/login` deu 200 e, se não deu, mostra o código e aponta o `.next`. Antes disso,
detecta `.next/static/development` e manda rodar a camada build.

## O buraco na validação que deixou o bug 2 passar

`/obras` estava na lista de rotas com `"esperaHtml": []`, ou seja, **só conferia
o status HTTP** — e a caixa de erro renderiza dentro de um HTTP 200. A tela
estava quebrada e a validação dizia "ok".

Duas mudanças, que valem pra qualquer rota daqui pra frente:

1. **Rota sem asserção positiva agora falha.** `esperaHtml` vazio virou erro,
   com a mensagem dizendo o que fazer.
2. **Nenhuma rota pode conter "Erro ao carregar" nem "Application error".**
   É uma asserção negativa global, aplicada a todas as rotas de uma vez — o
   jeito mais barato de pegar esta classe inteira.

E na camada de dados, que é mais barata que a de runtime, entraram duas
checagens: a view `obras_com_valores` com o select da tela, e
`calcular_valores_obra` rodada **para todas as obras**, porque o ramo que
quebrava é dormente e só aparece na obra que tem contrato.

## Multiperfil na validação

A senha dos usuários `@teste.com` de gc-dev não era a do `setup_inicial_dev.sql`.
Com sua autorização, a do `visualizador@teste.com` foi redefinida por
`scripts/resetar-senha-dev.mjs`, que tem duas travas por mexer em credencial com
service role: só roda contra o project ref de gc-dev, e só aceita e-mail
`@teste.com` — conta de pessoa real se troca pelo painel.

A camada runtime passou a aceitar `"perfil": "visualizador"` numa rota e fazer
login com o segundo usuário. As quatro asserções novas provam o que antes só
estava escrito no código:

| Rota | O que prova |
|---|---|
| `/propostas` | lê a listagem e **não** vê "Nova proposta" |
| `/propostas/nova` | 307 — o guard da page, já que o layout libera visualizador |
| `/propostas/[id]` | vê o detalhe, sem "Mudar status" nem "Excluir" |
| `/propostas/[id]/editar` | 307 |

## Verificação

| Camada | Resultado |
|---|---|
| estático | `tsc --noEmit` limpo, lint sem warnings |
| unitário | 46 casos, `fail 0` |
| build | 31 rotas, iguais à baseline |
| runtime | 39/39 rotas, incluindo 16 em perfil não-admin |
| dados | 12/12 checagens sob RLS em gc-dev |
| escrita | 35/35 passos exercitando as Server Actions, com limpeza |

## Pendências

1. **O EmptyState de "nenhuma proposta cadastrada" segue sem render.** Precisa
   de zero propostas visíveis, o que hoje só uma segunda empresa em gc-dev
   daria. Fica registrado como escolha, não como esquecimento.
2. **A migration 012 não rodou em gc-prod, e não vai rodar por aqui.** Regra do
   projeto desde 2026-09-05: não trabalhamos em gc-prod (`CLAUDE.md`). O registro
   que importa passar adiante é o diagnóstico: **`/obras` está quebrada lá pelo
   mesmo gatilho** — qualquer obra com contrato vigente ou proposta aprovada —,
   e a correção é esta migration.
3. ~~A escrita segue sem exercício.~~ **Resolvida em 2026-09-05** pela camada 6
   (`scripts/validar-escrita.mjs`): criar, editar, mudar status, histórico,
   anexo e excluir rodam contra gc-dev, com as recusas de perfil. O que sobra é
   o clique — nenhuma tela foi aberta em navegador.
4. **Os outros cinco usuários `@teste.com`** continuam com senha desconhecida.
   Não foram mexidos de propósito: trocar credencial de conta que outra pessoa
   pode estar usando não se faz sem pedir. Quando algum bloco precisar de
   `comercial`, `financeiro`, `producao` ou `medicao`, é um comando
   (`scripts/resetar-senha-dev.mjs`) e um aviso.

## Arquivos

| Arquivo | O que é |
|---|---|
| `supabase/migrations/20260905190000_fix_calcular_valores_obra_ambiguidade.sql` | novo. Qualifica as referências da função |
| `src/lib/listagem.ts` | `isRangeForaDoAlcance`, `urlSemPagina`, `RANGE_FORA_DO_ALCANCE` |
| `src/lib/listagem.test.ts` | 3 casos novos |
| `src/app/(app)/{propostas,orcamentos,fd,obras,clientes}/page.tsx` | redirect na página fora do alcance |
| `scripts/validar.sh` | diagnóstico de servidor e detecção de `.next` de dev |
| `scripts/validar-runtime.mjs` | login por perfil, asserção positiva obrigatória, proibição global de "Erro ao carregar" |
| `scripts/validar-dados.mjs` | checagens da view e da função de obras |
| `scripts/validacao-rotas.json` | 23 rotas, 4 delas como visualizador |
| `scripts/resetar-senha-dev.mjs` | novo. Reset de senha de usuário `@teste.com` em gc-dev |
