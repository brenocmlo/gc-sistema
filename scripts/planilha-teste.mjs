/**
 * Planilha de teste da importação de itens (bloco 5.8): 50 linhas, com linhas
 * propositalmente inválidas.
 *
 * Um módulo só para dois usos, para o teste automático e o manual nunca
 * divergirem:
 *   - a camada navegador (`scripts/validar-navegador.mjs`) importa
 *     `planilhaDeTeste()` e sobe o arquivo pela tela;
 *   - `node scripts/planilha-teste.mjs [caminho]` grava o mesmo arquivo em
 *     disco para quem quiser testar à mão (padrão: /tmp/gc-planilha-teste-50.xlsx).
 *
 * O layout é o do template real: as instruções de `INSTRUCOES_TEMPLATE`, uma
 * linha em branco, o cabeçalho de `COLUNAS_IMPORTACAO` e a linha de exemplo.
 * Os itens são de esquadria e fachada, como os de uma proposta de verdade.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const TIPOS = [
  ['Janela', 'Janela de correr 2 folhas', 'Suprema', 'Branco', 'M2', 1.5, 1.2, 890.5],
  ['Janela', 'Janela maxim-ar com tela', 'Suprema', 'Preto', 'M2', 0.8, 0.6, 645],
  ['Porta', 'Porta de abrir com bandeira fixa', 'Gold', 'Bronze', 'M2', 0.9, 2.1, 2340.75],
  ['Porta', 'Porta de correr 2 folhas', 'Gold', 'Bronze', 'M2', 1.6, 2.1, 3180],
  ['Guarda-corpo', 'Guarda-corpo em vidro laminado 8+8', 'Linha 30', 'Escovado', 'QTD', null, null, 1986.08],
  ['Fachada', 'Pele de vidro unitizada, módulo 1,25 m', 'Unitizada', 'Anodizado', 'M2', 1.25, 3.0, 1450],
  ['Fachada', 'Revestimento em ACM 4 mm', 'ACM', 'Cinza', 'M2', 1.0, 3.0, 380],
  ['Brise', 'Brise móvel em alumínio', 'Brise', 'Branco', 'QTD', null, null, 720],
  ['Box', 'Box de correr em vidro temperado 8 mm', 'Linha 25', 'Cromado', 'M2', 1.2, 1.9, 1750],
  ['Serviço', 'Instalação e vedação com silicone estrutural', null, null, 'QTD', null, null, 8900],
  ['Serviço', 'Transporte e içamento de peças', null, null, 'QTD', null, null, 2100],
]

/** Linhas válidas: 44, numeradas de 101 a 144. */
const VALIDAS = 44
const PRIMEIRO_NUMERO = 101

/**
 * As 6 linhas que o preview TEM de recusar, cada uma por um motivo diferente.
 * A linha de exemplo do template conta como uma delas.
 */
const INVALIDAS = [
  { motivo: 'quantidade zero', v: { numero: 145, tipo: 'Erro', descricao: 'Quantidade zero', quantidade: 0, unidade: 'QTD', valor_unit: 10 } },
  { motivo: 'unidade ML (removida do CHECK)', v: { numero: 146, tipo: 'Erro', descricao: 'Unidade ML', quantidade: 1, unidade: 'ML', valor_unit: 10 } },
  { motivo: 'número repetido no arquivo', v: { numero: PRIMEIRO_NUMERO, tipo: 'Erro', descricao: 'Número repetido', quantidade: 1, unidade: 'QTD', valor_unit: 10 } },
  { motivo: 'número não inteiro', v: { numero: 147.5, tipo: 'Erro', descricao: 'Número quebrado', quantidade: 1, unidade: 'QTD', valor_unit: 10 } },
  { motivo: 'valor unitário negativo', v: { numero: 148, tipo: 'Erro', descricao: 'Valor negativo', quantidade: 1, unidade: 'QTD', valor_unit: -5 } },
]

export async function planilhaDeTeste() {
  const { COLUNAS_IMPORTACAO, INSTRUCOES_TEMPLATE } = await import('../src/lib/itens-form.ts')
  const { default: ExcelJS } = await import('exceljs')

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Itens')
  const linha = (v) => COLUNAS_IMPORTACAO.map((c) => v[c.chave] ?? null)

  for (const i of INSTRUCOES_TEMPLATE) ws.addRow([i])
  ws.addRow([])
  ws.addRow(COLUNAS_IMPORTACAO.map((c) => c.titulo))
  ws.addRow(linha(Object.fromEntries(COLUNAS_IMPORTACAO.map((c) => [c.chave, c.exemplo]))))

  let soma = 0
  const validas = []
  for (let k = 0; k < VALIDAS; k++) {
    const [tipo, descricao, linhaProduto, acabamento, unidade, largura, altura, valorUnit] = TIPOS[k % TIPOS.length]
    const quantidade = (k % 4) + 1
    const v = {
      numero: PRIMEIRO_NUMERO + k,
      tipo,
      descricao: `${descricao} — posição ${k + 1}`,
      linha: linhaProduto,
      acabamento,
      localizacao: `Pavimento ${(k % 5) + 1}`,
      largura,
      altura,
      quantidade,
      unidade,
      valor_unit: valorUnit,
    }
    ws.addRow(linha(v))
    validas.push(v)
    soma += valorUnit * quantidade
  }
  // As inválidas no meio e no fim, não todas juntas: o preview tem de achar
  // cada uma onde estiver.
  for (const { v } of INVALIDAS) ws.addRow(linha(v))

  const buffer = Buffer.from(await wb.xlsx.writeBuffer())
  return {
    buffer,
    esperado: {
      linhas: 1 + VALIDAS + INVALIDAS.length, // exemplo + válidas + inválidas
      validas: VALIDAS,
      comErro: 1 + INVALIDAS.length,
      soma: Math.round(soma * 100) / 100,
      primeiroNumero: PRIMEIRO_NUMERO,
      motivos: ['linha de exemplo do template', ...INVALIDAS.map((i) => i.motivo)],
    },
  }
}

// Uso direto: grava o arquivo para teste manual.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const destino = process.argv[2] ?? '/tmp/gc-planilha-teste-50.xlsx'
  const { buffer, esperado } = await planilhaDeTeste()
  writeFileSync(destino, buffer)
  console.log(`gravado ${destino}`)
  console.log(`esperado no preview: ${esperado.linhas} linhas, ${esperado.validas} válidas, ${esperado.comErro} com erro`)
  console.log(`soma das válidas: R$ ${esperado.soma.toFixed(2)}`)
  console.log(`linhas recusadas: ${esperado.motivos.join('; ')}`)
}
