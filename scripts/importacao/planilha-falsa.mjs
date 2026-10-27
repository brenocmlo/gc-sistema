/**
 * Planilha FALSA no formato que se espera da "Gestão Contratos.xlsx", para
 * exercitar o importador enquanto a real não chega. Traz de propósito os casos
 * difíceis do bloco 14.1: o mesmo cliente com três nomes, obra sem código,
 * fabricada vazia, várias execuções por item, NF "Atrasada", link do Drive,
 * e linhas que TÊM de ser ignoradas (unidade inválida, instalada acima do
 * total, NF inexistente, a descontar acima do valor).
 *
 * Decisão 2 do 14.1: a obra 01 tem DUAS propostas aprovadas (P1, a principal
 * pela data, vira o contrato CT-VALIDA-IMP-P1; P4 vira aditivo dele, e a
 * execução de P4 fica no item da proposta), e a obra 02 está concluída (o
 * contrato CT-VALIDA-IMP-P2 nasce concluido). A NF de medição da obra 02 sem
 * nada medido exercita o aviso da decisão 3.
 *
 * Tudo leva VALIDA-IMP (obra, cliente, proposta, contrato CT-VALIDA-IMP-*,
 * descrição do item), que o verificar-sobras acha se uma rodada morrer.
 *
 *   node scripts/importacao/planilha-falsa.mjs <saida.xlsx>
 */
import ExcelJS from 'exceljs'

const saida = process.argv[2]
if (!saida) {
  console.error('Uso: node scripts/importacao/planilha-falsa.mjs <saida.xlsx>')
  process.exit(2)
}

const wb = new ExcelJS.Workbook()
const aba = (nome, titulo, cabecalho, linhas) => {
  const ws = wb.addWorksheet(nome)
  // Título antes do cabeçalho, como planilha de verdade: o leitor tem de achar a linha certa.
  ws.addRow([titulo])
  ws.addRow([])
  ws.addRow(cabecalho)
  for (const l of linhas) ws.addRow(l)
  return ws
}

aba('Obras', 'CADASTRO DE OBRAS', ['Código', 'Obra', 'Cliente', 'Cidade', 'Situação'], [
  ['VALIDA-IMP-01', 'VALIDA-IMP Torre Norte', 'VALIDA-IMP Estação Fashion', 'Fortaleza', 'Em andamento'],
  ['VALIDA-IMP-02', 'VALIDA-IMP Torre Sul', 'VALIDA-IMP ESTAÇÃO  FASHION', 'Fortaleza', 'Concluída'],
  ['', 'VALIDA-IMP Galpão', 'VALIDA-IMP EF Empreendimentos Imobiliarios', 'Caucaia', ''],
])

const props = aba('Propostas', 'PROPOSTAS', ['Nº Proposta', 'Obra', 'Data', 'Valor Total', 'Desconto', 'Status', 'Documento'], [
  ['VALIDA-IMP-P1', 'VALIDA-IMP-01', '10/02/2026', 'R$ 10.000,00', 0, 'Aprovada', ''],
  ['VALIDA-IMP-P2', 'VALIDA-IMP Torre Sul', new Date(Date.UTC(2026, 2, 1)), 5000, 500, 'Fechada', ''],
  ['VALIDA-IMP-P3', 'VALIDA-IMP Galpão', 46100, 2000, 0, 'xyz', ''],
  // Segunda aprovada da obra 01, emitida depois da P1: vira aditivo do contrato da P1.
  ['VALIDA-IMP-P4', 'VALIDA-IMP-01', '01/04/2026', 1500, 0, 'Aprovada', ''],
])
props.getCell('G4').value = { text: 'proposta P1', hyperlink: 'https://drive.google.com/file/d/VALIDA-IMP-P1' }

aba('Itens', 'ITENS', ['Nº Proposta', 'Item', 'Tipo', 'Descrição', 'Qtd', 'Unidade', 'Valor Unitário'], [
  ['VALIDA-IMP-P1', 1, 'Janela', 'VALIDA-IMP Janela de correr', 10, 'UN', 500],
  ['VALIDA-IMP-P1', 2, 'Fachada', 'VALIDA-IMP Pele de vidro', 50, 'm²', 100],
  ['VALIDA-IMP-P2', 1, 'Porta', 'VALIDA-IMP Porta pivotante', 4, 'UN', 1250],
  ['VALIDA-IMP-P2', 2, 'Guarda-corpo', 'VALIDA-IMP Guarda-corpo de vidro', 3, 'litro', 100],
  ['VALIDA-IMP-P4', 1, 'Janela', 'VALIDA-IMP Janela do aditivo', 3, 'UN', 500],
])

aba('Controle de Execução', 'CONTROLE DE EXECUÇÃO', ['Nº Proposta', 'Item', 'Qtd', 'Qtd Fabricada', 'Qtd Instalada', 'Local'], [
  ['VALIDA-IMP-P1', 1, 6, '', 6, 'Térreo'],
  ['VALIDA-IMP-P1', 1, 4, '', 1, '1º andar'],
  ['VALIDA-IMP-P1', 2, '', '', 20, 'Fachada leste'],
  ['VALIDA-IMP-P2', 1, '', '', 9, 'Hall'],
  ['VALIDA-IMP-P4', 1, '', '', 2, 'Cobertura'],
])

aba('Notas Fiscais', 'NOTAS FISCAIS', ['Nº NF', 'Série', 'Obra', 'Proposta', 'Tipo', 'Emissão', 'Vencimento', 'Valor', 'Status'], [
  ['VALIDA-IMP-NF1', '1', 'VALIDA-IMP-01', 'VALIDA-IMP-P1', 'Sinal', '15/02/2026', '15/03/2026', 'R$ 4.000,00', 'Paga'],
  ['VALIDA-IMP-NF2', '1', 'VALIDA-IMP-02', 'VALIDA-IMP-P2', 'Medição', '20/03/2026', '20/04/2026', 2250, 'Atrasada'],
])

const pg = aba('Pagamentos', 'EXTRATO', ['Nº NF', 'Data', 'Valor', 'Forma', 'Observação', 'Comprovante'], [
  ['VALIDA-IMP-NF1', '01/03/2026', 2500, 'PIX', 'VALIDA-IMP parcela 1', ''],
  ['VALIDA-IMP-NF1', '10/03/2026', 1500, 'Transferência', 'VALIDA-IMP parcela 2', ''],
  ['VALIDA-IMP-NF9', '10/03/2026', 100, 'PIX', 'VALIDA-IMP NF que não existe', ''],
])
pg.getCell('F4').value = { text: 'comprovante', hyperlink: 'https://drive.google.com/file/d/VALIDA-IMP-PG1' }

aba('FD', 'FATURAMENTO DIRETO', ['Obra', 'Fornecedor', 'Data', 'Especificação', 'Qtd', 'Un', 'Valor', 'A Descontar', 'Observação'], [
  ['VALIDA-IMP-01', 'Vidraçaria Teste', '05/03/2026', 'Vidro laminado', 20, 'm2', 3000, 3000, 'VALIDA-IMP fd 1'],
  ['VALIDA-IMP-01', 'Alumínio Teste', '06/03/2026', 'Perfil', 100, 'kg', 1500, '', 'VALIDA-IMP fd 2'],
  ['VALIDA-IMP Galpão', 'Ferragens Teste', '07/03/2026', 'Fechaduras', 8, 'peças', 400, 500, 'VALIDA-IMP fd 3'],
])

wb.addWorksheet('Resumo').addRow(['Aba de resumo: o importador não lê'])

await wb.xlsx.writeFile(saida)
console.log(`planilha falsa gravada em ${saida}`)
