# Exportações XLSX — o padrão visual

Data: 2026-09-30 · Branch: `main`

Todas as rotas de `/api/export/*` montam a planilha pelo mesmo gerador,
`src/lib/excel-export.ts` (`buildWorkbookResponse`). Até aqui ele produzia uma tabela crua:
título em negrito, cabeçalho cinza-claro, nenhuma borda, nenhum destaque. O Breno apontou que
a do Faturamento Direto estava "muito feia e não muito atrativa visualmente". O gerador foi
refeito, então **as 9 planilhas mudaram juntas**: as exportações de obras, orçamentos,
propostas, contratos, FD, execução, notas fiscais e pagamentos, e o **modelo de importação de
itens** (`/api/template/itens`).

## O que a planilha tem agora

| Parte | Como fica |
|---|---|
| Título | 16 pt, em negrito, mesclado na largura da tabela |
| Legenda (emitido em, filtros, total de registros) | 10 pt, cinza, mesclada na largura da tabela |
| Cabeçalho | fundo grafite (`#1F2937`) com texto branco em negrito, quebra de linha, **congelado** ao rolar, com o **filtro do Excel** |
| Linhas | zebradas (cinza bem claro nas pares), bordas finas cinza, altura fixa |
| Alinhamento | automático: valor em reais e número à direita, data ao centro, texto à esquerda (a coluna pode forçar com `align`) |
| Destaque | opcional por coluna (`destaque: (linha) => 'positivo' \| 'negativo' \| 'atencao' \| 'neutro'`): texto em negrito com a cor dos selos da tela (verde, vermelho, âmbar, cinza) e um fundo claro da mesma cor |
| Total | fundo cinza, negrito, borda superior média; a soma continua sendo uma fórmula `SUM` |
| Grade | as linhas de grade do Excel ficam escondidas (a tabela tem bordas) |
| Impressão | paisagem, cabendo na largura da folha (A4), e o cabeçalho repete em cada página |

**A estrutura não mudou**: as mesmas linhas de legenda, o cabeçalho com os mesmos nomes, as
linhas de dado e a linha TOTAL com a fórmula. Era o que o plano de validação lê (o runtime
procura o cabeçalho e os textos; a escrita lê "Total de registros:", "Filtros:" e a fórmula do
total), e por isso as checagens continuam valendo.

O modelo de importação de itens é lido de volta pelo sistema (`lerPlanilhaItens`), então foi
conferido à parte: o arquivo servido pela rota, com o gerador novo, foi lido pelo importador e
devolveu a linha de exemplo (2026-09-30, `next dev` contra gc-dev). O importador acha o
cabeçalho pela célula "Nº" em qualquer coluna, e as instruções mescladas não atrapalham.

Uma observação para quem lê a planilha por código: com as linhas da legenda mescladas, o
ExcelJS devolve o mesmo texto em todas as células da faixa. Procurar o texto (`find`) funciona;
contar células não.

## O FD, especificamente

Além do gerador, `src/app/api/export/fd/route.ts`:

- **Qtd e Preço unit. em branco** quando o item não tem: antes vinham `0`, o que parecia um item
  de quantidade zero (a maioria dos FDs não tem quantidade).
- **Status com destaque**: Pago em verde, Vencido em vermelho, Pendente em âmbar.

As outras exportações não ganharam `destaque` ainda; é uma linha por coluna de status, se for
pedido.

## Como conferir

O exemplo gerado com os dados de gc-dev foi salvo em `~/Downloads/fd-novo-visual.xlsx`
(2026-09-30). A conferência visual no Excel é do Breno: a validação lê os valores, não a
aparência.
