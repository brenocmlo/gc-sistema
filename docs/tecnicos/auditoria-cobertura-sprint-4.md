# Auditoria de cobertura da sprint 4 — furos fechados

Data: 2026-09-10. Branch: `feature-dev-breno-automacao`, idêntica à `main`
(merge pelo PR #3, `9003fcc`). Working tree, sem commit.

## Por que este documento existe

A sprint 4 foi fechada e mergeada com as sete camadas do plano de validação
verdes. A pergunta que originou esta auditoria foi outra: **as camadas cobrem o
que a sprint mexeu?** Conferir isso é diferente de rodar o plano — o plano prova
o que está escrito nele, não o que ficou de fora.

Comparei `af55913..HEAD` (86 arquivos) contra as três obrigações do `CLAUDE.md`,
arquivo por arquivo: rota tocada tem linha em `validacao-rotas.json`, query tem
contrapartida em `validar-dados.mjs`, Server Action tem passo em
`validar-escrita.mjs`, tela nova tem roteiro em `validar-navegador.mjs`.

O que estava em ordem, para não repetir a conferência depois:

- **`rotas-esperadas.txt` bate exatamente** com as 30 rotas de `src/app` — a
  única diferença é `/_not-found`, que é do próprio `next build`.
- **Toda query das 10 pages tocadas tem contrapartida** na camada de dados:
  `fd`, `obras`, `obras_com_valores`, `orcamentos`, `profiles`, `propostas`,
  `propostas_financeiro`, e `clientes` dentro dos JOINs.
- **`historico` é conferido nas duas tabelas** (propostas e orçamentos).

## Os cinco furos

### 1. Dois exports tocados e nunca buscados

`/api/export/fd` e `/api/export/orcamentos` perderam o `computePeriodoCutoff`
local para o helper de `@/lib/listagem` (−14 linhas cada) e **nenhuma camada
buscava as duas rotas**. Os exports com asserção eram só `propostas` e `obras`.

Entraram em `validacao-rotas.json` com `esperaContentType` e `esperaXlsx`. O de
FD confere **"Diferença a favor"**, que é coluna derivada: só sai certa se o
cálculo estiver aplicado na exportação também, e é justamente o que um helper
compartilhado quebrando silenciosamente estragaria.

### 2. `getAnexoUrl` sem nenhum exercício

Era a única Server Action nova de Propostas sem passo. É quem gera a URL
assinada de 1 hora — o bucket é privado, então **visualizar anexo depende dela**.

Três checagens novas na camada de escrita: a action responde, a URL traz
`token=` de assinatura, e **um fetch na URL baixa o PDF** (200 e os bytes
`%PDF`). Só a string não provaria nada: assinatura ou path errados devolvem 400
do Storage, e a action teria respondido `ok` do mesmo jeito.

### 3. `novaEntradaHistoricoOrcamento` sem teste unitário

Das cinco exportações de `src/lib/historico.ts`, quatro são reexportadas por
`propostas.ts` e já estavam cobertas em `propostas.test.ts`. A quinta não — e é
a que carrega a pegadinha do status masculino (`rejeitado` em orçamentos,
`rejeitada` em propostas), que **não quebra build nem tipo**: só faz o histórico
deixar de gravar o motivo.

`src/lib/historico.test.ts`, novo, com 5 casos. Um deles fixa a pegadinha ao
contrário: usar o atalho de orçamento numa proposta `rejeitada` descarta o
motivo em silêncio, e o teste registra esse comportamento em vez de deixá-lo
implícito.

### 4. A camada de navegador só abria Propostas

O `HistoricoTab` é compartilhado, e desde o 4.6 renderiza também em
`/orcamentos/[id]` — rota que **nunca tinha sido aberta num navegador**. A
camada runtime só provava que a string "Histórico" sai no HTML do servidor.

Passo 13 novo: abre `/orcamentos`, clica na linha da tabela, abre a aba. O
clique é na `<tr>`, não num link — o `DataTable` navega por `onClick` com
`router.push`, então o passo de quebra exercita a navegação client-side, que
nenhuma outra camada tocava. Screenshot em `11-orcamento-historico.png`.

### 5. Skip silencioso: três checagens de permissão paradas desde 2026-09-08

O pior dos cinco, e o único que só apareceu **rodando**. A camada de escrita
tinha as checagens de visualizador atrás de um gate de ambiente:

```js
if (EMAIL_VIS && SENHA_VIS) { ... } else {
  console.log('  PULOU checagens de perfil — VALIDACAO_*_VISUALIZADOR ausente')
}
```

Quando o bloco 4.8 eliminou as senhas de perfil do `.env.local` (pendência 3, em
2026-09-08), essas duas variáveis saíram junto. A partir dali a camada **pulava
as três checagens, imprimia "PULOU" e devolvia exit 0** — "visualizador não
cria", "não muda status" e "não exclui" deixaram de ser medidas sem que nada
falhasse.

Consequência nos números registrados: os **35/35** que os blocos 4.6, 4.7 e 4.8
documentam foram medidos **antes** da remoção das variáveis. Depois dela, o
honesto seriam 32 checagens rodando — e ninguém rodou o plano entre 08/09 e
hoje, então o número documentado nunca refletiu o estado final daquele dia. Não
era número errado quando foi escrito; virou número velho no mesmo dia.

O gate saiu. A sessão do visualizador agora vem de `sessaoDePerfil`, o mecanismo
sem senha que o próprio 4.8 criou — se falhar, estoura, que é o comportamento
que se quer de uma checagem de permissão.

## Dois defeitos do roteiro que só a execução mostrou

Nenhum dos dois era problema da aplicação; os dois faziam o plano reprovar (ou
passar) por motivo errado.

1. **Seletor pegava o botão errado.** `a[href^="/orcamentos/"]` acerta primeiro
   o botão "Novo orçamento". Com `:not([href$="/novo"])` não sobrou nada — as
   linhas da tabela não são links. O alvo certo é `table tbody tr`.

2. **O toast interceptava o clique.** O passo de exclusão de proposta falhou com
   "esperando demais por: ConfirmDialog" numa rodada e passou em duas outras. O
   screenshot `99-erro.png` mostrou por quê: o toast "Anexo excluído" fica no
   canto superior direito, sobre a faixa do botão "Excluir" do header, e o
   clique daqui é evento de mouse **em coordenada** — acerta o que está por
   cima. Com o `next dev` frio o toast já tinha expirado quando o roteiro
   chegava ali; com ele quente, não. O roteiro agora espera o toast sair.

   Isso é flakiness que existia antes desta auditoria e ia reprovar em rodada
   rápida, sem nada errado no sistema.

Uma correção de digitação em `src/lib/historico.ts` ("divergc" → "diverge"),
comentário, sem efeito.

## Verificação

*Sete camadas numa rodada só, 2026-09-10, contra gc-dev.*

| Camada | Resultado |
|---|---|
| estático | `tsc --noEmit` limpo, lint sem warnings (11s) |
| unitário | **51 casos, fail 0** — eram 46; os 5 novos são de `historico.test.ts` |
| build | **31 rotas**, iguais à baseline (nenhuma rota nova; as duas de export já existiam) |
| runtime | **41/41 rotas** — eram 39; as 2 novas são `/api/export/orcamentos` e `/api/export/fd`, com asserção de conteúdo da planilha |
| dados | **12/12 checagens** sob RLS |
| escrita | **38/38 passos** — eram 35 documentados, dos quais 3 não rodavam; agora são 32 + 3 de permissão voltando + 3 de `getAnexoUrl` |
| navegador | **24/24 passos**, console limpo, **13 screenshots** |

O `tsc` pegou um erro meu no caminho: o teste novo usava
`motivo_rejeicao: 'prazo'`, que não existe em `MotivoRejeicao` (é
`prazo_curto`). `npm test` tinha passado, porque `node --test` remove os tipos
sem conferir — a ordem das camadas funcionou como devia.

## O que continua sem validação

Lista nominal, como manda a regra do projeto.

1. **As entradas do histórico renderizando em `/orcamentos/[id]`.** O passo novo
   prova o componente montando **no estado vazio**. Os 28 orçamentos de gc-dev
   têm `historico` vazio (`count(*) filter (where jsonb_array_length(historico)
   > 0)` = **0**; a migration 013 é aditiva). Encher o histórico de um orçamento
   real sujaria dado de seed sem limpeza, e reverter status não é transição
   permitida. As entradas seguem provadas na tela de Propostas (passo 10) e no
   banco pela camada de escrita.
2. **O botão "Visualizar" do anexo não é clicado pela tela.** A action
   `getAnexoUrl` está coberta por HTTP; o botão que a chama, não.
3. **Dez rotas seguem fora da camada runtime**, nenhuma delas tocada pela sprint
   4: `/login`, `/configuracoes`, `/contratos`, `/financeiro`, `/clientes/novo`,
   `/clientes/[id]/editar`, `/fd/novo`, `/fd/[id]`, `/fd/[id]/editar`,
   `/obras/nova`, `/obras/[id]/editar`, `/orcamentos/novo`,
   `/orcamentos/[id]/editar` e `/api/relatorio/fd-conciliacao/[obraId]`.
4. **Conferência visual continua manual.** Existem 13 screenshots; eu abri
   **dois** (`99-erro.png`, que explicou o toast, e `11-orcamento-historico.png`,
   que confirmou a aba montada em ORC-2026-001). Os outros onze não foram
   olhados por ninguém nesta rodada.
5. **Nada foi conferido no banco por olho humano** — só pelos scripts. A camada
   de escrita limpa o que cria (proposta e orçamento de teste), e o passo de
   orçamento no navegador não escreve nada.

## Arquivos

| Arquivo | O que mudou |
|---|---|
| `scripts/validacao-rotas.json` | +2 rotas de export, com `esperaXlsx`. 39 → 41 |
| `scripts/validar-escrita.mjs` | `getAnexoUrl` em `NECESSARIAS` e 3 checagens; gate de env do visualizador trocado por `sessaoDePerfil` |
| `scripts/validar-navegador.mjs` | passo 13 (`/orcamentos/[id]` + aba Histórico) e a espera do toast antes da exclusão |
| `src/lib/historico.test.ts` | **novo.** 5 casos de `novaEntradaHistoricoOrcamento` |
| `src/lib/historico.ts` | digitação em comentário |
| `docs/tecnicos/auditoria-cobertura-sprint-4.md` | este documento |
