# Progresso da obra com contrato — status de entrega

Correção fora de bloco, feita na janela da Sprint 14 · Data: 2026-10-26 · Branch: `main` ·
Ambiente: gc-dev (`gzbmhgnpoehormnidmgg`)

---

## Resumo

**Validado em 2026-10-27:** a migration `20261026100000` está aplicada em gc-dev e a rodada completa do
`npm run validar` passou nas sete camadas (seção Validação).

**O defeito:** a coluna `progresso_itens_pct` da view `obras_com_valores`, que a listagem `/obras`
mostra, dividia a quantidade medida pela soma das quantidades de **todos** os itens da obra, tanto os
de proposta quanto os de contrato (`20260512151918_progresso_itens_obra.sql:30-46`). Nenhuma
migration posterior redefiniu a view. A conta errava por três motivos:

- **O item copiado contava duas vezes.** Desde o bloco 6.2, `gerar_contrato_de_proposta` copia os
  itens da proposta para o contrato, e a proposta fica com os dela. Como só item de contrato vigente
  recebe execução (7.2), mesmo com tudo medido a obra parava em **50%**.
- **Entrava item de proposta que não foi vendida**, em rascunho, enviada ou rejeitada.
- **Entrava item de contrato rescindido.**

O revisor do 14.1 achou o defeito, e a importação da planilha (decisão 2 do 14.1, um contrato por
obra) o levaria a todas as obras importadas.

## A regra

**Progresso = quantidade medida ÷ quantidade contratada × 100**, com duas casas.

"Contratado" é o mesmo conjunto que `calcular_valores_obra` já usa para o valor da obra:

- os itens dos **contratos não rescindidos** da obra;
- os itens das **propostas aprovadas que ainda não geraram contrato** não rescindido
  (`contratos.proposta_origem_id`).

O numerador soma só a medição desses itens. Quando o contratado soma zero, a coluna vem `NULL`, e a
tela mostra "sem dados". A obra concluída continua aparecendo com 100% pela regra da tela
(`obras-table.tsx`).

**Por que a regra do valor, e não "só contrato quando houver contrato":** a pergunta era se o
progresso deve ignorar uma proposta aprovada que ainda não virou contrato quando a obra já tem
outro contrato. As duas regras dão o mesmo número quando a obra tem um único contrato, que é o caso
que a regra "uma obra, um contrato vigente" (`docs/tecnicos/regra-um-contrato-por-obra.md`) vai
garantir. Elas só diferem nesse caso misto. Com a regra do valor, o progresso mede contra o mesmo
total que o valor da obra mostra ao lado, e a proposta aprovada sem contrato aparece como trabalho
vendido e ainda não medido. Os vários contratos vigentes do seed antigo (OBRA-2025-03) também somam.

**O que muda para quem usa:** a obra que só tem proposta em rascunho passa de "0%" para "sem dados".
Em gc-dev, hoje, nenhuma obra está nesse caso.

## Antes e depois em gc-dev

Leitura direta em gc-dev, só de leitura, antes e depois do `db push`. O teto é o máximo que a coluna
alcança com todos os itens de contrato medidos por inteiro: med = quantidade, o limite que a execução
aceita.

| Obra | Situação | Antes | Teto antes | Depois | Teto depois |
|---|---|---|---|---|---|
| BRA-2026-005 | contrato CT-2026-0042 (4 itens, 518 un) copiado de PROP-2026-0117 (4 itens, 518 un) | 0,00% | **50,00%** | 0,00% | **100,00%** |
| OBRA-2025-03 | 6 contratos vigentes com itens (55 un), 2 propostas em rascunho (40 un), 10 un medidas | **10,53%** | 57,89% | **18,18%** | 100,00% |
| OBRA-2026-001 | 1 contrato (45 itens, 157 un), 44 un medidas | 28,03% | 100,00% | 28,03% | 100,00% |
| OBRA-2027-01 | sem itens | sem dados | — | sem dados | — |

**A BRA-2026-005 é o caso exato do defeito.** O contrato copiou os 4 itens da proposta. Com tudo
medido, a obra mostraria 50%. Ela não muda hoje porque nada foi medido nela.

**A OBRA-2025-03** muda já: as 40 unidades das propostas em rascunho saem do denominador.

**A OBRA-2026-001** não muda, porque só tem itens de contrato.

## Arquivos

| Arquivo | O quê |
|---|---|
| `supabase/migrations/20261026100000_progresso_itens_so_contratado.sql` | Aplicada em gc-dev. Faz o `create or replace view obras_com_valores` com o filtro do contratado na subconsulta do progresso. As colunas e a ordem não mudam, e a view continua `security_invoker`. É idempotente |
| `src/lib/progresso-obra.ts` | Espelho puro da regra: `itensContratados` e `progressoItensDaObra`. Usado pela camada dados |
| `src/lib/progresso-obra.test.ts` | 7 casos: contrato copiado (o defeito), só proposta aprovada, contrato rescindido (a proposta de origem volta a contar), caso misto, vários contratos, `NULL` sem contratado e `numeric` em string |
| `scripts/validacao/validar-dados.mjs` | Checagem nova (ver Validação) |
| `src/app/(app)/obras/obras-table.tsx` | Só o comentário, que dizia "NULL quando obra não tem itens" |
| `src/lib/supabase/types.ts` | **Não mudou.** Gerados de novo contra gc-dev depois do push, os types saíram idênticos (`diff` vazio) |

## Validação

**Rodada final de 2026-10-27** (`caffeinate -ims npm run validar`): **passou nas sete camadas.**

| Camada | Resultado | Deste bloco |
|---|---|---|
| estático | limpo (`tsc --noEmit` + `next lint`) | nenhum erro novo |
| unitário | **432 casos** | **7 casos novos** (`progresso-obra.test.ts`) |
| build | **66 rotas**, iguais à baseline | a migration não muda rota |
| runtime | **327/327 rotas** + **348 células** da varredura de URL direta | a migration não muda rota |
| dados | **65/65 checagens** (1 sem registro em gc-dev); matriz de RLS: **456 células** de tabela e **108** de bucket | **1 checagem nova**, `obras_com_valores: progresso_itens_pct = medido / contratado`, com 4 obras, sob RLS; discrimina na OBRA-2025-03 (view antiga 10,53 contra 18,18 da conta manual) |
| escrita | **529/529 passos**, com o ensaio da importação **17/17** dentro dela | a escrita não toca a view |
| navegador | **281/281 passos**; screenshots em `/tmp/gc-validacao/shots` | a coluna Progresso não é fotografada |

As camadas isoladas de 2026-10-26 (estático limpo, 432 casos, dados 65/65) foram as mesmas que a rodada confirmou.

**Rodadas do estático:** a primeira parou em dois erros `TS2802`. Um era meu (espalhar um `Set` no
teste, trocado por `Array.from`). O outro estava em `src/lib/importacao.ts:306`, fora desta
correção, e já tinha sido corrigido quando a camada rodou de novo. A segunda rodada passou.

**Rodadas do unitário:** uma rodada intermediária deu 431/432 enquanto o working tree era editado
em paralelo. O caso que falhou não foi identificado, e a rodada seguinte passou com 432/432.

## Pendências

- **Conferência visual** da coluna Progresso em `/obras` não foi feita.
- **O caso do defeito não está exercitado com medição real:** em gc-dev, nenhuma obra tem contrato
  copiado de proposta e medição ao mesmo tempo. A BRA-2026-005 tem o contrato copiado, mas med = 0.
  A checagem da camada dados discrimina pela OBRA-2025-03, por causa dos itens em rascunho. O caso
  50% → 100% está provado no teste unitário e pelo teto calculado na tabela acima.
- **Dashboard:** o gráfico "progresso das obras" (12.4) usa outra conta, a média das quatro etapas
  sobre as linhas de `execucao`, e não lê esta coluna. Não foi mexido.

## Registro para quem for operar gc-prod

A migration `20261026100000_progresso_itens_so_contratado.sql` entra depois de
`20261019100000_pedidos_acesso.sql`. Ela só troca a definição da view `obras_com_valores`
(`create or replace`, mesmas colunas e na mesma ordem) e refaz o `grant select` para
`authenticated`. Ela não mexe em dado nem em tabela. O progresso das obras com contrato gerado de
proposta muda na hora: deixa de parar em 50%.
