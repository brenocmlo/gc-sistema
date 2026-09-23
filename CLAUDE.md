# gc-sistema — instruções do projeto

Next.js 14 (App Router) + Supabase. Português nos comentários, nas mensagens de
UI e nos documentos.

## Regra de validação — obrigatória ao concluir qualquer task

**Antes de declarar uma task pronta, rode `npm run validar`.** São sete
camadas, do mais barato ao mais caro, parando no primeiro erro:

| Camada | Comando | O que prova |
|---|---|---|
| estatico | `tsc --noEmit` + `next lint` | compila e passa no lint |
| unit | `npm test` | regra pura dos helpers |
| build | `next build` + diff de rotas | toda rota monta, nenhuma sumiu |
| runtime | `next start` + fetch autenticado | a rota abre com sessão real e o HTML tem o esperado |
| dados | queries da aplicação sob RLS em gc-dev | select, JOIN e policy funcionam |
| escrita | Server Actions por HTTP contra gc-dev | criar, editar, status, histórico, anexo e excluir, com as regras de perfil |
| navegador | Chrome headless por CDP sobre o `next dev` | o que só roda no cliente: zod do formulário, diálogo condicional, toast, navegação; deixa screenshots |

Camada isolada: `bash scripts/validar.sh dados`. Detalhe do que cada uma prova
e **não** prova: `bash scripts/validar.sh --lista` e `docs/tecnicos/plano-validacao.md`.

Três obrigações que vêm com a regra:

1. **Estender o plano junto com o código.** Tela nova entra em
   `scripts/validacao-rotas.json` (rota + trechos de HTML que provam o render).
   Query nova entra em `scripts/validar-dados.mjs`, **copiada do `page.tsx`**.
   Server Action nova entra em `scripts/validar-escrita.mjs`, com limpeza do que
   criar. Tela ou diálogo novo entra em `scripts/validar-navegador.mjs`.
   Regra de permissão por perfil entra como rota com `"perfil": "<nome>"` em
   `scripts/validacao-rotas.json` — a sessão é gerada sem senha por
   `scripts/sessao-dev.mjs`, e perfil novo é uma linha em `PERFIS_DE_TESTE`.
   Rota nova exige `bash scripts/validar.sh build --aceitar-rotas` pra regravar
   `scripts/rotas-esperadas.txt`.
2. **Registrar os números reais** no documento de status do bloco
   (`docs/sprint-<N>/<m.n>-status-entrega.md`), uma linha por camada — "31 casos",
   "29 rotas", "9/9 rotas", "6/6 checagens". Nunca "passa" genérico, nunca
   número lido de outro lugar do output.
3. **Listar o que não foi validado** como pendência nominal. Camada que não
   rodou aparece como "não rodou". Query que voltou zero linha aparece como
   "não exercitada". Conferência visual e escrita no banco continuam manuais —
   se não foram feitas, isso é escrito.

Nunca marcar uma task como concluída com o plano reprovando ou sem tê-lo rodado.

## Documentação

`docs/` é dividido por **trilha de trabalho**, uma pasta por sprint. Índice
completo em `docs/README.md`.

```
docs/
  sprint-<N>/   entregas da sprint N do ClickUp (tag s<N> na lista
                "Plataforma Gestão de Obras"): um `<m.n>-status-entrega.md`
                por bloco, mais o que for daquela sprint e só dela
  automacao/    trilha OCR/WhatsApp/Telegram — lista "OCR Contratos
                (WhatsApp) — Breno" no ClickUp, que tem numeração PRÓPRIA
                (1 a 8) e NÃO usa blocos m.n
  tecnicos/     o que atravessa sprints: nota técnica, processo, auditoria
```

- **`<m.n>-*.md` é reservado a documento de task**, e mora em
  `docs/sprint-<N>/`. O `m.n` é o número do bloco no ClickUp —
  `docs/sprint-4/4.3-status-entrega.md` é a entrega do bloco 4.3. **Nunca use
  um número de bloco pra documento que não é daquela task**, e não invente um:
  se o trabalho não tem bloco (o caso da trilha `automacao/`), o arquivo leva
  nome descritivo.
- **Sprint nova = pasta nova.** Criar `docs/sprint-5/` ao abrir o primeiro
  bloco da sprint 5; não deixar documento de sprint solto na raiz de `docs/`.
- **A regra de corte entre sprint e `tecnicos/` é a vida útil**, não o nome: se
  o documento morre junto com a task, é `docs/sprint-<N>/`; se continua valendo
  depois, é `docs/tecnicos/` mesmo que fale de uma sprint só. Por isso
  `auditoria-cobertura-sprint-4.md` está em `tecnicos/` — o plano de validação
  ainda depende dela — e `sprint-4-apresentacao-gestao.md` está em `sprint-4/`.
- **Só `.md` e `.pdf` ficam versionados.** `bash scripts/docs-pdf.sh <arquivo>`
  gera o PDF; o HTML é intermediário e vive no diretório temporário. O script
  sem argumento varre `docs/*.md` e `docs/*/*.md`, então as subpastas entram.

## Convenções que o plano não pega

- **`as`, nunca `as unknown as`** no retorno de `select()`. Com `as`, o `tsc`
  ainda compara a string da query com o `Database` gerado e acusa coluna
  inexistente; com o duplo, para de comparar.
- **Helpers puros em `src/lib/`**, sem `use client` e sem import de React, pra
  servirem Server Component, Server Action e Client Component. É o que os torna
  testáveis por `node --test`.
- **Listagens** seguem o padrão de `/orcamentos`, `/fd` e `/propostas`: estado
  todo na URL, busca com debounce de 300 ms, `PAGE_SIZE = 20`, `Pagination`
  compartilhado, período por `computePeriodoCutoff` de `@/lib/listagem`.
- **Guard de layout protege a rota, não a ação.** Server Action de escrita
  repete a checagem de perfil por conta própria.

## gc-prod está fora do escopo

**Não trabalhamos em gc-prod.** Só **gc-dev** (`gzbmhgnpoehormnidmgg`).

Isso vale para tudo que toca o banco: migration, `db push`, `db diff`, seed,
reset de senha, geração de types e as camadas runtime e dados do
`npm run validar`. Se uma tarefa parecer exigir gc-prod, **pare e pergunte** —
não é decisão de execução.

A regra é executada, não só escrita: `scripts/gc-dev-guard.mjs` aborta qualquer
script que abra conexão com um project ref diferente, e o `validar.sh` confere o
`.env.local` antes das camadas que conectam.

O que fica registrado para prod (migrations pendentes, ordem de aplicação,
backup) mora nos documentos de entrega, como **registro para quem for operar
prod** — não como tarefa nossa.

## Fluxo de trabalho

- **Não commitar nem dar push sem pedido explícito.** O trabalho fica no working
  tree.
- **Sem branch por tarefa.** Tudo na branch de trabalho atual.
- **Migrations** ficam em `supabase/migrations/`, aplicadas pela CLI. O
  `supabase migration repair --status applied` das dez versões **já foi feito em
  gc-dev** (2026-09-05, bloco 4.1): `db push` em gc-dev não precisa de preparo.
  A pendência do repair vale **só para gc-prod**, quando despausar — ver
  `supabase/README.md`.
- **gc-prod está pausado.** Só gc-dev (`gzbmhgnpoehormnidmgg`) é ambiente de
  trabalho. Atenção: em 2026-09-21 o **gc-dev também estava `INACTIVE`** por
  inatividade. Projeto pausado não aceita conexão, e as camadas runtime, dados e
  escrita do `npm run validar` falham com timeout de login role. Confira o status
  antes de culpar o código:
  `curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" https://api.supabase.com/v1/projects`