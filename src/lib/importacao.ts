/**
 * Regras da importação da planilha legada "Gestão Contratos.xlsx" (sprint 14),
 * puras e testadas. Quem lê a planilha e grava no banco é
 * `scripts/importacao/importar-planilha.mjs`; aqui fica só o que transforma o
 * valor de uma célula no valor de um campo.
 *
 * Cada decisão de negócio do bloco 14.1 (decididas em 2026-10-26 por análise,
 * por delegação do Breno) é UMA função, para ser trocada sozinha quando a
 * planilha real pedir:
 *   - decisão 1 (clientes duplicados): `nomeCanonicoDoCliente` + a tabela de
 *     equivalências do mapa;
 *   - decisão 2 (contratos): `contratosDaImportacao`, `numeroDoContratoImportado`,
 *     `statusObraDaPlanilha` e `statusContratoDaObra`;
 *   - decisão 3 (cascata da execução): `cascataDaExecucao`, e a conferência
 *     `conferenciaDaMedicao`;
 *   - decisão 5 (data de corte): `datasDoFd`;
 *   - status de NF: `statusNfDaPlanilha`.
 */

/** Espaços nas pontas e repetidos, como a planilha costuma trazer. */
export function normalizarTexto(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim()
}

/** Para comparar nomes: sem acento, sem caixa, sem pontuação. */
export function chaveDeComparacao(v: unknown): string {
  return normalizarTexto(v)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Decisão 1: o nome do cliente como vai para o banco. `equivalencias` é
 * `{ "nome canônico": ["variação 1", "variação 2"] }`, preenchida pela equipe.
 * Sem equivalência, variações de caixa e acento já viram o mesmo cliente; nome
 * de fato diferente ("EF EMPREENDIMENTOS…" × "Estação Fashion") só se junta
 * pela tabela.
 */
export function nomeCanonicoDoCliente(nome: unknown, equivalencias: Record<string, string[]> = {}): string {
  const bruto = normalizarTexto(nome)
  const chave = chaveDeComparacao(bruto)
  for (const [canonico, variacoes] of Object.entries(equivalencias)) {
    if (chaveDeComparacao(canonico) === chave) return canonico
    if (variacoes.some((v) => chaveDeComparacao(v) === chave)) return canonico
  }
  return bruto
}

/** Número de célula: número do Excel, "1.234,56", "R$ 1.234,56", "1234.5", "10%". */
export function numeroDaPlanilha(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let s = normalizarTexto(v).replace(/^R\$\s*/i, '').replace(/\s/g, '')
  if (!s || s === '-') return null
  const pct = s.endsWith('%')
  if (pct) s = s.slice(0, -1)
  // "1.234,56" (BR) ou "1,234.56" (US): o último separador é o decimal.
  const ultimaVirgula = s.lastIndexOf(',')
  const ultimoPonto = s.lastIndexOf('.')
  if (ultimaVirgula > ultimoPonto) s = s.replace(/\./g, '').replace(',', '.')
  else if (ultimoPonto > ultimaVirgula && ultimaVirgula >= 0) s = s.replace(/,/g, '')
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return pct ? n / 100 : n
}

/** Data de célula → "AAAA-MM-DD": Date, número de série do Excel ou "dd/mm/aaaa". */
export function dataDaPlanilha(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10)
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    // Série do Excel: dias desde 1899-12-30 (o "bug do 1900" já descontado).
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000).toISOString().slice(0, 10)
  }
  const s = normalizarTexto(v)
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
  if (m) {
    const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    const d = new Date(Date.UTC(ano, Number(m[2]) - 1, Number(m[1])))
    if (d.getUTCMonth() !== Number(m[2]) - 1) return null
    return d.toISOString().slice(0, 10)
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

export type StatusNfPlanilha = 'emitida' | 'paga' | 'cancelada'

/**
 * Status de NF como a planilha escreve → o que se ESPERA no sistema depois da
 * importação. "Atrasada" é emitida: o atraso sai da data de vencimento, em
 * tempo de execução. Quem grava o status de fato é o trigger dos pagamentos
 * (paga, paga parcialmente); este valor serve para a conciliação conferir.
 */
export function statusNfDaPlanilha(v: unknown): StatusNfPlanilha | null {
  const s = chaveDeComparacao(v)
  if (!s) return null
  if (/^paga?$|^pago$|quitad/.test(s)) return 'paga'
  if (/cancel/.test(s)) return 'cancelada'
  if (/atrasad|aberto|a vencer|vencid|emitid|pendente|aguardando/.test(s)) return 'emitida'
  return null
}

export type StatusProposta = 'rascunho' | 'enviada' | 'aprovada' | 'rejeitada'

export function statusPropostaDaPlanilha(v: unknown): StatusProposta | null {
  const s = chaveDeComparacao(v)
  if (!s) return null
  if (/aprovad|fechad|ganha|contratad/.test(s)) return 'aprovada'
  if (/rejeitad|recusad|perdid|cancelad/.test(s)) return 'rejeitada'
  if (/enviad|negociac|aguardando|em analise/.test(s)) return 'enviada'
  if (/rascunho|elaborac/.test(s)) return 'rascunho'
  return null
}

const FORMAS: [RegExp, string][] = [
  [/pix/, 'pix'],
  [/boleto/, 'boleto'],
  [/\bted\b|\bdoc\b|transfer/, 'ted'],
  [/deposit/, 'deposito'],
  [/cheque/, 'cheque'],
  [/dinheiro|especie/, 'dinheiro'],
  [/cartao|credito|debito/, 'cartao'],
]

/** Forma de pagamento; o que não reconhece vira 'outro' (o texto vai na observação). */
export function formaDePagamento(v: unknown): string {
  const s = chaveDeComparacao(v)
  for (const [re, forma] of FORMAS) if (re.test(s)) return forma
  return 'outro'
}

/** Unidade do item: o banco aceita QTD e M2. */
export function unidadeDoItem(v: unknown): 'QTD' | 'M2' | null {
  const s = chaveDeComparacao(String(v ?? '').replace(/²/g, '2')).replace(/\s/g, '')
  if (!s) return 'QTD'
  if (/^m2$|^mq$|metroquadrad/.test(s)) return 'M2'
  if (/^(qtd|qt|un|und|unid|unidade|pc|pca|peca)s?$/.test(s)) return 'QTD'
  return null
}

const UNIDADES_FD: Record<string, string> = { un: 'UN', und: 'UN', unid: 'UN', unidade: 'UN', kg: 'KG', m: 'M', ml: 'M', m2: 'M2', pc: 'PC', pca: 'PC', peca: 'PC' }

export function unidadeDoFd(v: unknown): string | null {
  const s = chaveDeComparacao(String(v ?? '').replace(/²/g, '2')).replace(/\s/g, '').replace(/s$/, '')
  if (!s) return null
  return UNIDADES_FD[s] ?? 'OUTRO'
}

export type Cascata = { fab: number; ent: number; inst: number; med: number }

/**
 * Decisão 3 (crítica): a aba Controle de Execução só tem fabricada (que vem
 * vazia) e instalada, e o banco exige med ≤ inst ≤ ent ≤ fab ≤ total. Decidido
 * em 2026-10-26 por análise, por delegação do Breno (14.1): o que foi
 * instalado foi fabricado e entregue (fab = ent = maior entre fabricada e
 * instalada; ent nunca abaixo de inst), e a medição começa em zero salvo se a
 * planilha trouxer; nunca deduzida da NF.
 *
 * Devolve a cascata ou o motivo da recusa (a linha vai para o log de
 * ignoradas, sem gravar).
 */
export function cascataDaExecucao(input: {
  total: number
  fabricada?: number | null
  entregue?: number | null
  instalada?: number | null
  medida?: number | null
}): { ok: true; cascata: Cascata; ajustes: string[] } | { ok: false; motivo: string } {
  const n = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? null : v)
  const total = input.total
  const fabInf = n(input.fabricada)
  const entInf = n(input.entregue)
  const inst = n(input.instalada) ?? 0
  const med = n(input.medida) ?? 0
  for (const [rotulo, v] of [['total', total], ['fabricada', fabInf], ['entregue', entInf], ['instalada', inst], ['medida', med]] as const) {
    if (v != null && v < 0) return { ok: false, motivo: `quantidade ${rotulo} negativa (${v})` }
  }
  if (inst > total) return { ok: false, motivo: `instalada (${inst}) maior que o total do item (${total})` }
  if (med > inst) return { ok: false, motivo: `medida (${med}) maior que a instalada (${inst})` }

  const ajustes: string[] = []
  const ent = Math.max(entInf ?? 0, inst)
  if (entInf == null && ent > 0) ajustes.push(`entregue assumida = ${ent} (a planilha não tem a coluna)`)
  else if (entInf != null && entInf < inst) ajustes.push(`entregue ${entInf} < instalada ${inst}: entregue = ${ent}`)
  const fab = Math.max(fabInf ?? 0, ent)
  if (fabInf == null && fab > 0) ajustes.push(`fabricada assumida = ${fab} (veio vazia)`)
  else if (fabInf != null && fabInf < ent) ajustes.push(`fabricada ${fabInf} < entregue ${ent}: fabricada = ${fab}`)
  if (fab > total) return { ok: false, motivo: `fabricada (${fab}) maior que o total do item (${total})` }
  return { ok: true, cascata: { fab, ent, inst, med }, ajustes }
}

/** FNV-1a de 32 bits em hexadecimal: estável entre execuções, sem dependência. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * Chave de idempotência das linhas que não têm chave natural no banco
 * (pagamento e FD): os campos que identificam a linha, comparados sem acento e
 * sem caixa. Vai na observação como `[importacao:<chave>]`; rodar de novo acha
 * a marca e não duplica. Linha editada na planilha entre duas rodadas vira
 * outra chave, então a importação final roda sobre a planilha congelada.
 */
export function chaveDeImportacao(entidade: string, partes: unknown[]): string {
  return `${entidade}-${fnv1a(partes.map((p) => chaveDeComparacao(p instanceof Date ? p.toISOString() : p)).join('|'))}`
}

export function marcaDeImportacao(chave: string): string {
  return `[importacao:${chave}]`
}

/** Observação + marca + link do Drive (decisão 4, opção "manter como link"). */
export function observacaoComMarca(partes: { texto?: unknown; link?: unknown; chave: string }): string {
  const linhas = [normalizarTexto(partes.texto), normalizarTexto(partes.link) ? `Arquivo: ${normalizarTexto(partes.link)}` : '', marcaDeImportacao(partes.chave)]
  return linhas.filter(Boolean).join('\n')
}

/** Código de obra a partir do nome, quando a planilha não tem coluna de código. */
export function codigoDeObraDoNome(nome: unknown): string {
  const base = chaveDeComparacao(nome).toUpperCase().replace(/\s+/g, '-').slice(0, 40)
  return base ? `LEGADO-${base}` : ''
}

export type StatusObra = 'ativa' | 'concluida' | 'suspensa' | 'cancelada'

/**
 * Status da obra como a planilha escreve (revisão da decisão 2 do 14.1). Vazio
 * ou não reconhecido devolve null: quem monta decide (entra `ativa`, com aviso
 * se havia texto).
 */
export function statusObraDaPlanilha(v: unknown): StatusObra | null {
  const s = chaveDeComparacao(v)
  if (!s) return null
  if (/cancel/.test(s)) return 'cancelada'
  if (/conclu|finaliz|encerrad|entregue/.test(s)) return 'concluida'
  if (/suspens|paralisad|parad/.test(s)) return 'suspensa'
  if (/ativ|andamento|execuc|em obra|iniciad/.test(s)) return 'ativa'
  return null
}

/** Decisão 2: o contrato importado é `concluido` se a obra estiver concluída; senão, `ativo`. */
export function statusContratoDaObra(statusObra: StatusObra | null | undefined): 'ativo' | 'concluido' {
  return statusObra === 'concluida' ? 'concluido' : 'ativo'
}

/**
 * Decisão 2: número do contrato importado. Vale o da coluna de contrato da
 * aba de propostas, se a planilha tiver; senão, `<prefixo><nº da proposta>`.
 */
export function numeroDoContratoImportado(numeroProposta: unknown, colunaContrato?: unknown, prefixo = 'CT-'): string {
  return normalizarTexto(colunaContrato) || `${prefixo}${normalizarTexto(numeroProposta)}`
}

export type CriterioPrincipal = 'data_emissao_asc' | 'valor_desc' | 'numero_asc'

export const CRITERIOS_PRINCIPAL: CriterioPrincipal[] = ['data_emissao_asc', 'valor_desc', 'numero_asc']

export interface PropostaParaContrato {
  numero: string
  obra: string
  status: string
  data_emissao?: string | null
  valor_total?: number | null
}

/**
 * Decisão 2: um contrato por obra que tenha proposta aprovada. A principal é
 * a aprovada com a data de emissão mais antiga (sem data vai por último); no
 * empate, a de maior valor; depois, o menor número. As outras aprovadas da
 * obra viram aditivos. Obra sem aprovada não aparece. A ordem da saída é a da
 * primeira aparição da obra na lista.
 */
export function contratosDaImportacao<P extends PropostaParaContrato>(
  propostas: P[],
  criterios: CriterioPrincipal[] = CRITERIOS_PRINCIPAL,
): { obra: string; principal: P; aditivos: P[] }[] {
  const comparar = (a: P, b: P): number => {
    for (const c of criterios) {
      let d = 0
      if (c === 'data_emissao_asc') {
        const da = a.data_emissao ?? null
        const db = b.data_emissao ?? null
        d = da === db ? 0 : da === null ? 1 : db === null ? -1 : da < db ? -1 : 1
      } else if (c === 'valor_desc') {
        d = (b.valor_total ?? 0) - (a.valor_total ?? 0)
      } else if (c === 'numero_asc') {
        d = a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true })
      }
      if (d !== 0) return d
    }
    return 0
  }
  const porObra = new Map<string, P[]>()
  for (const p of propostas) {
    if (p.status !== 'aprovada') continue
    porObra.set(p.obra, [...(porObra.get(p.obra) ?? []), p])
  }
  return Array.from(porObra.entries()).map(([obra, lista]) => {
    const [principal, ...aditivos] = [...lista].sort(comparar)
    return { obra, principal, aditivos }
  })
}

/**
 * Decisão 5: as datas do FD. `data` é o que vai para `data_lancamento` (a
 * coluna é obrigatória: na falta, vencimento e depois pagamento). `dataDoCorte`
 * é a que o corte compara: só lançamento ou pagamento, nunca o vencimento, para
 * o FD lançado antes do corte com vencimento depois não sair como ignorado.
 */
export function datasDoFd(d: { lancamento?: string | null; vencimento?: string | null; pagamento?: string | null }): {
  data: string | null
  dataDoCorte: string | null
  soVencimento: boolean
} {
  const lancamento = d.lancamento ?? null
  const vencimento = d.vencimento ?? null
  const pagamento = d.pagamento ?? null
  return {
    data: lancamento ?? vencimento ?? pagamento,
    dataDoCorte: lancamento ?? pagamento,
    soVencimento: !lancamento && !pagamento && Boolean(vencimento),
  }
}

/**
 * Decisão 3, conferência por obra: a medição nunca é deduzida da NF, mas a NF
 * de medição sem nada medido (ou acima do instalado) é avisada.
 *   - aviso: NF de medição > 0 e Σ med_qtd = 0 (apontar a medição antes de
 *     emitir o relatório);
 *   - divergência: NF de medição > Σ(inst × valor_unit), com um centavo de folga.
 */
export function conferenciaDaMedicao(o: { nfMedicao: number; somaMedida: number; instaladoValor: number }): {
  tipo: 'aviso' | 'divergencia'
  texto: string
}[] {
  const saida: { tipo: 'aviso' | 'divergencia'; texto: string }[] = []
  const reais = (v: number) => `R$ ${v.toFixed(2)}`
  if (o.nfMedicao > 0 && o.somaMedida === 0) {
    saida.push({ tipo: 'aviso', texto: `NF de medição de ${reais(o.nfMedicao)} e nada medido na execução: apontar a medição antes de emitir o relatório` })
  }
  if (o.nfMedicao > o.instaladoValor + 0.01) {
    saida.push({ tipo: 'divergencia', texto: `NF de medição (${reais(o.nfMedicao)}) maior que o instalado × valor unitário (${reais(o.instaladoValor)})` })
  }
  return saida
}
