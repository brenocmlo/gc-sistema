# Manual do usuário — perfil Financeiro

Bloco [15.1 Manual do usuário por perfil](https://app.clickup.com/t/86e31aq43) · Sprint 15 ·
Data: 2026-10-26 · Fonte: o código em `main` (working tree de 2026-10-26)

---

## Para quem é

Para quem entra com o perfil **Financeiro**: *"Notas fiscais, pagamentos, acordos e FD"*. O que
está entre aspas é o texto exato da tela.

## 1. O que o Financeiro vê

| Menu | O que faz |
|---|---|
| Dashboard | Pendências e atalhos |
| Obras | Consulta; a aba **Financeiro** da obra é dele (seção 7) |
| Financeiro | Abas Visão geral, Notas fiscais, Pagamentos, Acordos |
| Faturamento Direto | Lança e edita FD |
| Meu perfil | Os próprios dados e a senha |

Clientes, Orçamentos, Propostas, Contratos, Documentos, Execução, Logs e Configurações não aparecem.
**Só o admin** exclui NF, estorna pagamento e exclui FD: o Financeiro não vê o botão, ou o vê
desabilitado.

**No Dashboard:** atalhos "Registrar pagamento", "Nova nota fiscal", "Novo FD" e "Visão geral"; e,
em **Suas pendências**, "NFs e parcelas vencidas" e "FDs vencidos sem pagamento", quando houver.
[tela: 49-dashboard.png]

## 2. Visão geral

`Financeiro` no menu abre aqui. Filtros: obra e período ("Este mês" é o padrão; "Últimos 30 dias",
"Últimos 90 dias", "Este ano", "Todo o período").

| Cartão | O que é |
|---|---|
| A receber | Saldo pendente das obras. Desconta o avulso e o pagamento a mais, então pode ser menor que a soma das faixas |
| Recebido no período | Os pagamentos do período |
| Atrasado | O saldo vencido; em vermelho quando passa de zero |
| Previsto para 30 dias | O que vence de hoje até daqui a 30 dias |

- **Por obra:** Faturado e Recebido seguem o período; **Saldo atual e % recebido são da obra
  inteira**. Obra sem NF, parcela nem pagamento fica de fora.
- **Contas a receber por vencimento:** faixas "Vencidas", "Vencem hoje", "Próximos 7 dias" e "De 8
  a 30 dias", com link para a NF ou o acordo. **Vencer hoje ainda não é vencida.**

[tela: 48-financeiro-visao-geral.png] · [tela: 48-financeiro-visao-geral-390.png]

## 3. Notas fiscais

**Listagem:** busca por número, chave da NF-e ou obra; filtros de obra, tipo, status e período
(emissão). Colunas: Número/Série, Obra, Tipo, Emissão, Vencimento, Valor, Recebido, Status.

| Status | Quando |
|---|---|
| Emitida | Sem pagamento |
| Paga parcialmente | Recebeu parte |
| Paga | Recebeu o valor inteiro |
| Cancelada | Cancelada à mão; definitivo |
| Vencida | Emitida ou paga parcialmente com vencimento **antes de hoje**. Calculada na hora, não gravada |

**Ninguém muda o status à mão.** Registrar pagamento leva a NF a paga parcialmente ou paga;
estornar a traz de volta. Quem faz isso é o banco (trigger dos pagamentos).

**"Nova nota fiscal":**
- Obrigatórios: Obra, Número, Tipo, Valor total (R$), Emissão.
- Série: opcional; "Número e série são únicos por empresa".
- Chave da NF-e: opcional, 44 dígitos, não se repete.
- Vínculo: "Sem vínculo", "Contrato" ou "Proposta" da obra. **Um ou outro, nunca os dois.**
- Tipo: Sinal, Entrega de material, Medição, Instalação, Faturamento direto, Outro.
- Vencimento: opcional, não antes da emissão.

O formulário marca o erro em cada campo antes de enviar. [tela: 34-nf-form-erros.png]

**O detalhe** mostra Valor total, Recebido e A receber, e os botões:
- **"Registrar pagamento"**: o formulário de pagamento já com esta NF e o saldo como valor.
- **"Editar"**: desabilitado na cancelada.
- **"Cancelar NF"**: pede o "Motivo do cancelamento" (mínimo de 5 caracteres). **"Esta ação é
  irreversível."** A NF não edita, não exclui nem recebe mais; o já recebido continua registrado.

Abas: Detalhes, Pagamentos, **Arquivos** (um XML e um PDF, até 10 MB cada: "Enviar XML" ou "Enviar PDF", "Substituir",
"Visualizar") e Histórico.

[tela: 35-nf-detalhe.png] · [tela: 37-nf-arquivos.png] · [tela: 36-nf-cancelar.png] · [tela: 36-nf-historico.png]

## 4. Pagamentos

**Listagem:** busca por obra, número da NF ou observação; filtros de obra, origem, forma e período.
No topo, **"Total recebido"** do que os filtros mostram. Colunas: Data, Obra, Origem, Documento,
Forma, Valor, Comprovante. [tela: 38-pagamentos-listagem.png]

**"Registrar pagamento":** obra, origem e o vínculo dela.

| Origem | Para quê | Pede |
|---|---|---|
| NF | Baixa de uma nota fiscal | A NF (canceladas não aparecem) |
| Acordo | Parcela de um acordo, sem NF | O acordo aberto e a parcela |
| Avulso | Dinheiro sem nota nem acordo | Observação obrigatória |

Depois: Data do pagamento, Valor (R$) e Forma (Pix, TED, Boleto, Cartão, Depósito, Dinheiro,
Cheque, Outro). A tela mostra o **"Saldo em aberto"**; valor acima dele gera aviso amarelo, e **o
pagamento pode ser salvo assim mesmo**. [tela: 39-pagamento-aviso.png]

**O efeito:** a NF ou a parcela vai a paga parcialmente ou paga. Pagas todas as parcelas válidas,
**o acordo fica quitado sozinho**. O avulso entra no recebido da obra.

**Comprovante:** anexado **depois** de registrar, na coluna Comprovante ("Anexar", "Substituir",
"Ver"). PDF, JPG, PNG ou WEBP, até 20 MB; conteúdo que não bate com a extensão é recusado.
[tela: 41-pagamento-comprovante.png]

**Errou?** Não há edição de pagamento. O admin estorna (exclui) e o pagamento é registrado de novo;
o status da NF ou da parcela é recalculado. [tela: 40-estorno-dialogo.png]

## 5. Acordos de pagamento

O combinado com o cliente para receber **sem NF**, em parcelas.

**Listagem:** busca por descrição, período ou obra; filtros de obra, status, motivo e período. No
acordo aberto, o status mostra quantas parcelas estão atrasadas. [tela: 42-acordos-listagem.png]

| Status | Quando |
|---|---|
| Aberto | Recebe pagamento e muda de parcela |
| Quitado | Parcelas válidas todas pagas (automático), ou encerrado à mão |
| Cancelado | Encerrado à mão sem pagamento |
| Convertido em NF | Virou nota fiscal |

**"Novo acordo":** Obra, Descrição, Motivo (Sinal, Adiantamento de material, Cliente sem NF,
Aditivo informal, Emergencial, Outro), Período de referência, Abertura e vínculo opcional (contrato
**ou** proposta). Em **Parcelas**, informe Valor total, Nº de parcelas, 1º vencimento e
Periodicidade (Mensal, Quinzenal (15 dias), Semanal) e clique **"Gerar parcelas"**; cada linha pode
ser ajustada ou removida. **O valor do acordo é a soma das parcelas**; a cancelada não conta.

**O detalhe** mostra Valor total, Recebido e Saldo; abas Parcelas, Detalhes e Anexos. A parcela
pode estar Pendente, Paga parcialmente, Paga, Cancelada ou **Atrasada** (calculada, como a NF
vencida). Com o acordo aberto: "Registrar pagamento" na linha, "Adicionar parcela", editar e
cancelar parcela. O valor não fica abaixo do já pago; parcela com pagamento não é cancelada.
[tela: 43-acordo-parcelas.png] · [tela: 44-acordo-detalhe.png]

**Encerrar à mão** (não se desfaz):
- **"Encerrar como quitado"**: cancela as parcelas pendentes e quita pelo que já foi pago. Bloqueado
  com parcela paga parcialmente ou sem nenhuma parcela paga.
- **"Cancelar acordo"**: pede o motivo (mínimo de 5 caracteres). Sem pagamento, tudo cancelado.
  **Com pagamento, encerra como quitado pelo recebido**, e esse valor fica no recebido da obra.

[tela: 46-acordo-encerrado.png]

**"Converter em NF"**, quando o cliente passa a pedir nota. O diálogo pede os dados da NF e avisa:
- o acordo vira "convertido em NF" e para de receber;
- **a NF deve valer o saldo do acordo, não o total**, para o saldo da obra não mudar;
- os pagamentos já lançados ficam arquivados: no histórico, fora do recebido da obra;
- não dá para desfazer.

O tipo sugerido vem do motivo (Sinal → Sinal; Adiantamento de material → Entrega de material; o
resto → Outro). [tela: 45-acordo-converter.png]

## 6. Faturamento Direto (FD)

O que **o cliente pagou direto ao fornecedor** e a empresa desconta.

**Listagem:** busca por pedido, fornecedor, código ou especificação; filtros de obra, status e
período. Colunas: Lançamento, Pedido / Doc., Obra, Fornecedor, Valor, A favor, Status pgto. O
status sai das datas: **Pago** (tem data de pagamento), **Vencido** (sem pagamento e vencimento
antes de hoje), **Pendente** (o resto).

**"Novo lançamento":**
- Identificação: Pedido / Documento, Item / Parcela.
- Obra e Datas: lançamento, vencimento e pagamento ("Preencha quando o cliente pagar o fornecedor").
- Produto / Serviço: Código, Unidade, Especificação, Quantidade, Preço unitário.
- Valores: Fornecedor, Valor (R$) ("O que o cliente gastou com o fornecedor") e Valor a descontar
  (R$) ("O que não concordamos"), mais a Justificativa ("Por que aceitamos esse desconto?").

A tela mostra a **"Diferença a nosso favor"** (Valor menos Valor a descontar): verde se positiva,
vermelha se negativa. No detalhe, o Financeiro edita e anexa **Evidências** (PDF, JPG, PNG, WebP ou
HEIC, até 20 MB). Excluir é do admin. No detalhe da obra, **"Relatório FD (PDF)"**.

[tela: FD — nenhuma no plano; ver Pendências]

## 7. A aba Financeiro da obra

Cartões Valor contratado, Faturado, Recebido, A receber, Atrasado e FD descontado; a tabela das NFs
da obra, a das parcelas de acordo e os recebimentos por mês. O link de uma obra na visão geral abre
direto aqui. [tela: 47-obra-financeiro.png] · [tela: 47-obra-financeiro-390.png]

## 8. Exportações

Visão geral, Notas fiscais, Pagamentos, Acordos e Faturamento Direto têm **"Exportar XLSX"**. A
planilha (`financeiro-`, `notas-fiscais-`, `pagamentos-`, `acordos-` ou `fd-<data>.xlsx`) leva **os
mesmos filtros da tela** e as mesmas colunas, mais algumas: Vínculo, Chave e Cancelamento na de NF;
Encerramento e NF da conversão na de acordos; o comprovante (Sim/Não) na de pagamentos.

Toda planilha tem a legenda com a data, os filtros e o total de registros, o cabeçalho congelado
com o filtro do Excel e a linha TOTAL. No FD, Pago fica verde, Vencido vermelho e Pendente âmbar.
Detalhe em `docs/tecnicos/exportacoes-xlsx.md`.

## 9. Meu perfil

Pelo menu do usuário no cabeçalho, ou por **"Meu perfil"** no rodapé da sidebar.

- **E-mail (login)** e **Perfil**: só leitura; para mudar, fale com o administrador.
- **Dados pessoais:** Nome e Telefone (o administrador usa para mandar o link de acesso pelo
  WhatsApp). "Salvar dados".
- **Trocar senha:** Senha atual, Nova senha (ao menos 8 caracteres, diferente da atual) e
  confirmação. "Trocar senha". A sessão continua aberta.

Esqueceu a atual? Saia e use **"Esqueci minha senha"** no login: o administrador recebe o pedido e
manda um link para criar outra.

[tela: 54-meu-perfil.png] · [tela: 54-meu-perfil-390.png] · [tela: 54-meu-perfil-senha-zod.png] · [tela: 53-esqueci-senha.png]

## Telas

As telas entram no PDF a partir das screenshots da camada navegador (rodada de 2026-10-27); marcadores sem screenshot: a tela de FD (sem screenshot no plano). Neste manual entraram 23 telas.

## Pendências

1. **Nenhuma tela de FD no plano.** A camada navegador não fotografa `/fd`; a seção 6 fica sem
   imagem até alguém tirar à mão.
2. **As telas não são do perfil Financeiro.** A maioria é da sessão de admin; Meu perfil, de um
   comercial descartável. Botões só do admin ("Excluir", "Estornar") podem aparecer na imagem.
3. **Ninguém do financeiro leu o guia ainda.**
4. **As telas não foram conferidas contra o texto** (conferência visual não feita).
