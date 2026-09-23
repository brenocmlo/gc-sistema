// Regra da rota de ingestão (Fase 6 da automação): valida o payload que o n8n
// manda e monta as linhas de `propostas` e `itens`. Sem React e sem Supabase,
// pra ser testável por `node --test` — o route handler só chama isto e grava.
//
// As decisões da Seção 4 do plano de migração moram aqui e nos helpers de
// `itens.ts` que a sprint 5 escreveu:
//   9  número da proposta é o do documento (duplicado → 409 na rota)
//   10 valor_unit ausente é inferido de valor_total / quantidade
//   11 unidade mapeada para QTD/M2, original em observacao
//   12 autor é o profile de serviço, uuid em created_by e em historico.por
//   16 a proposta se liga à obra; a rota confere obra × empresa
import {
  acrescentarObservacao,
  limparColunasGeradas,
  normalizarUnidade,
  notaDeInferencia,
  numeroItemDoDocumento,
  resolverValorUnit,
} from './itens.ts'
import {
  novaEntradaHistoricoProposta,
  pctToFraction,
  validarDesconto,
  validarSomaPct,
} from './propostas.ts'

/** Item como a Fase 5 extrai: literal do documento, nada normalizado. */
export type ItemExtraido = {
  numero?: unknown
  tipo?: unknown
  linha?: unknown
  acabamento?: unknown
  localizacao?: unknown
  descricao?: unknown
  quantidade?: unknown
  unidade?: unknown
  valor_unitario?: unknown
  valor_total?: unknown
  largura?: unknown
  altura?: unknown
  vidros?: unknown
  observacao?: unknown
}

export type PayloadIngestao = {
  documentoId?: unknown
  empresaId?: unknown
  obraId?: unknown
  numero?: unknown
  descricao?: unknown
  dataEmissao?: unknown
  dataValidade?: unknown
  valorTotal?: unknown
  desconto?: unknown
  condicoesPagamento?: unknown
  observacao?: unknown
  /** Percentuais de 0 a 100, como estão no documento. */
  pct?: {
    sinal?: unknown
    fd?: unknown
    entregaMaterial?: unknown
    medicaoInstalacao?: unknown
  } | null
  itens?: unknown
  origem?: { canal?: unknown; chatId?: unknown } | null
}

/** Linha de `itens` pronta pro insert, faltando só `proposta_id`. */
export type LinhaItemIngestao = {
  empresa_id: string
  obra_id: string
  numero: number | null
  tipo: string | null
  linha: string | null
  acabamento: string | null
  localizacao: string | null
  descricao: string | null
  quantidade: number
  unidade: 'QTD' | 'M2'
  valor_unit: number
  largura: number | null
  altura: number | null
  vidros: string | null
  observacao: string | null
  created_by: string
}

export type LinhaPropostaIngestao = {
  empresa_id: string
  obra_id: string
  numero: string
  descricao: string
  data_emissao: string | null
  data_validade: string | null
  valor_total: number
  desconto: number
  condicoes_pagamento: string | null
  observacao: string
  pct_sinal: number | null
  pct_fd: number | null
  pct_entrega_material: number | null
  pct_medicao_instalacao: number | null
  status: 'rascunho'
  created_by: string
  historico: ReturnType<typeof novaEntradaHistoricoProposta>[]
}

/**
 * Número vindo do documento: aceita number ou texto brasileiro
 * ("R$ 1.986,08", "01"). Devolve null para o que não for número.
 */
export function numeroBR(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const s = v.replace(/R\$/gi, '').replace(/\s/g, '')
  if (s === '') return null
  // "1.986,08" é brasileiro; "1986.08" já é ponto decimal.
  const t = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/**
 * Largura e altura: a coluna é em metros. O documento de referência escreve em
 * milímetros (950 × 2100) sem dizer a unidade. Uma esquadria de mais de 10 m
 * não existe na prática, então acima disso lê-se milímetro — e o original vai
 * para `observacao`, pra ninguém ter de confiar no chute.
 */
export function dimensaoEmMetros(v: unknown): { metros: number | null; deMilimetro: boolean } {
  const n = numeroBR(v)
  if (n === null || n < 0) return { metros: null, deMilimetro: false }
  if (n > 10) return { metros: Math.round((n / 1000) * 10000) / 10000, deMilimetro: true }
  return { metros: n, deMilimetro: false }
}

/**
 * Traduz um item extraído para a linha de `itens`. Devolve `ok: false` nos
 * casos sem conserto (decisão 10): sem nenhum dos dois valores, ou sem
 * quantidade — a rota responde 422 e o documento vai para REVISAO_HUMANA.
 * Nunca monta `valor_total` nem `area_m2`: são colunas geradas.
 */
export function montarItemIngestao(
  item: ItemExtraido,
  ctx: { empresaId: string; obraId: string; criadoPor: string },
):
  | { ok: true; linha: LinhaItemIngestao; inferido: boolean }
  | { ok: false; motivo: string } {
  const rotulo = texto(item.numero) ?? '?'
  const quantidade = numeroBR(item.quantidade)
  const valorTotalDoc = numeroBR(item.valor_total)
  const valorUnitDoc = numeroBR(item.valor_unitario)

  if (quantidade === null || quantidade <= 0) {
    return { ok: false, motivo: `item ${rotulo}: quantidade ausente ou zero` }
  }
  const resolvido = resolverValorUnit({ valorUnit: valorUnitDoc, valorTotal: valorTotalDoc, quantidade })
  if (!resolvido.ok) return { ok: false, motivo: `item ${rotulo}: ${resolvido.motivo}` }

  const notas: string[] = []
  if (resolvido.inferido) notas.push(notaDeInferencia(resolvido.de))

  const numero = numeroItemDoDocumento(item.numero)
  if (numero.original !== null) notas.push(`[item no documento: ${numero.original}]`)

  const unidadeOriginal = texto(item.unidade)
  const unidade = normalizarUnidade(unidadeOriginal)
  if (unidadeOriginal !== null && !unidade.reconhecida) {
    notas.push(`[unidade no documento: ${unidadeOriginal}]`)
  }

  const largura = dimensaoEmMetros(item.largura)
  const altura = dimensaoEmMetros(item.altura)
  if (largura.deMilimetro || altura.deMilimetro) {
    notas.push(`[medidas no documento: ${texto(item.largura) ?? '—'} × ${texto(item.altura) ?? '—'}, lidas como mm]`)
  }

  // Conferência do papel: unitário × quantidade contra o total impresso. O
  // documento de referência tem um item inconsistente (1 × 500 = 1.500); o
  // banco grava o unitário, e o total impresso fica registrado.
  if (!resolvido.inferido && valorTotalDoc !== null && valorTotalDoc > 0) {
    const calculado = resolvido.valorUnit * quantidade
    if (Math.abs(calculado - valorTotalDoc) > 0.01 * valorTotalDoc) {
      notas.push(`[total no documento: ${valorTotalDoc}]`)
    }
  }

  let observacao = texto(item.observacao)
  for (const n of notas) observacao = acrescentarObservacao(observacao, n)

  const linha = limparColunasGeradas({
    empresa_id: ctx.empresaId,
    obra_id: ctx.obraId,
    numero: numero.numero,
    tipo: texto(item.tipo),
    linha: texto(item.linha),
    acabamento: texto(item.acabamento),
    localizacao: texto(item.localizacao),
    descricao: texto(item.descricao),
    quantidade,
    unidade: unidade.unidade,
    valor_unit: Math.round(resolvido.valorUnit * 10000) / 10000,
    largura: largura.metros,
    altura: altura.metros,
    vidros: texto(item.vidros),
    observacao,
    created_by: ctx.criadoPor,
  }) as LinhaItemIngestao
  return { ok: true, linha, inferido: resolvido.inferido }
}

function dataISO(v: unknown): string | null {
  const s = texto(v)
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return br ? `${br[3]}-${br[2]}-${br[1]}` : null
}

/**
 * Valida o payload inteiro e monta proposta + itens. Tudo ou nada: um item sem
 * conserto recusa a ingestão inteira (422), pra não existir proposta meio
 * gravada. `avisos` não recusam — vão no aviso ao grupo de admin.
 */
export function montarIngestao(
  payload: PayloadIngestao,
  criadoPor: string,
  agora: string = new Date().toISOString(),
):
  | {
      ok: true
      proposta: LinhaPropostaIngestao
      itens: LinhaItemIngestao[]
      avisos: string[]
      somaItens: number
    }
  | { ok: false; error: string } {
  const documentoId = texto(payload.documentoId)
  const empresaId = texto(payload.empresaId)
  const obraId = texto(payload.obraId)
  const numero = texto(payload.numero)
  const faltando = [
    ['documentoId', documentoId],
    ['empresaId', empresaId],
    ['obraId', obraId],
    ['numero', numero],
  ].filter(([, v]) => !v).map(([k]) => k)
  if (faltando.length) return { ok: false, error: `Campos obrigatórios ausentes: ${faltando.join(', ')}` }

  const valorTotal = numeroBR(payload.valorTotal)
  if (valorTotal === null) return { ok: false, error: 'Valor total ausente ou ilegível' }
  const desconto = numeroBR(payload.desconto) ?? 0
  const vDesc = validarDesconto(valorTotal, desconto)
  if (!vDesc.ok) return { ok: false, error: vDesc.error }

  const p = payload.pct ?? {}
  const pct = {
    pct_sinal: pctToFraction(numeroBR(p.sinal)),
    pct_fd: pctToFraction(numeroBR(p.fd)),
    pct_entrega_material: pctToFraction(numeroBR(p.entregaMaterial)),
    pct_medicao_instalacao: pctToFraction(numeroBR(p.medicaoInstalacao)),
  }
  const vPct = validarSomaPct(pct)
  if (!vPct.ok) return { ok: false, error: vPct.error }

  const brutos = Array.isArray(payload.itens) ? (payload.itens as ItemExtraido[]) : []
  const ctx = { empresaId: empresaId!, obraId: obraId!, criadoPor }
  const itens: LinhaItemIngestao[] = []
  const recusas: string[] = []
  let inferidos = 0
  for (const bruto of brutos) {
    const r = montarItemIngestao(bruto ?? {}, ctx)
    if (!r.ok) recusas.push(r.motivo)
    else {
      itens.push(r.linha)
      if (r.inferido) inferidos++
    }
  }
  if (recusas.length) return { ok: false, error: `Itens sem conserto: ${recusas.join('; ')}` }

  // unique (proposta_id, numero): número repetido no documento vira null no
  // segundo em diante, com o original em observacao (vários nulos convivem).
  const vistos = new Set<number>()
  for (const it of itens) {
    if (it.numero === null) continue
    if (vistos.has(it.numero)) {
      it.observacao = acrescentarObservacao(it.observacao, `[item no documento: ${it.numero}, repetido]`)
      it.numero = null
    } else vistos.add(it.numero)
  }

  const avisos: string[] = []
  if (inferidos) avisos.push(`${inferidos} ${inferidos === 1 ? 'item teve' : 'itens tiveram'} o valor unitário calculado a partir do total`)
  const somaItens = Math.round(itens.reduce((acc, it) => acc + it.valor_unit * it.quantidade, 0) * 100) / 100
  // Com itens, o trigger da 5.6 faz propostas.valor_total = soma dos itens.
  if (itens.length && valorTotal > 0 && Math.abs(somaItens - valorTotal) > 0.01 * valorTotal) {
    avisos.push(`a soma dos itens (${somaItens.toFixed(2)}) difere do total do documento (${valorTotal.toFixed(2)}); o valor da proposta passa a ser a soma`)
  }

  const canal = texto(payload.origem?.canal) ?? 'automação'
  const rastro = `[automação · ${canal} · documento ${documentoId}]`
  const proposta: LinhaPropostaIngestao = {
    empresa_id: empresaId!,
    obra_id: obraId!,
    numero: numero!,
    descricao: texto(payload.descricao) ?? `Proposta recebida pela automação (${canal})`,
    data_emissao: dataISO(payload.dataEmissao),
    data_validade: dataISO(payload.dataValidade),
    valor_total: valorTotal,
    desconto,
    condicoes_pagamento: texto(payload.condicoesPagamento),
    observacao: acrescentarObservacao(texto(payload.observacao), rastro),
    ...pct,
    // Nasce rascunho, como pela tela: chegar pelo Telegram não é aprovar.
    status: 'rascunho',
    created_by: criadoPor,
    // A tela só escreve histórico na primeira transição; aqui a entrada marca
    // a origem (de = para = rascunho), com o uuid do autor (decisão 12).
    historico: [novaEntradaHistoricoProposta({ de: 'rascunho', para: 'rascunho', por: criadoPor, em: agora })],
  }
  return { ok: true, proposta, itens, avisos, somaItens }
}

/** Comparação em tempo constante, pra o tempo de resposta não vazar o token. */
export function tokenConfere(recebido: string | null | undefined, esperado: string | null | undefined): boolean {
  if (!recebido || !esperado || recebido.length !== esperado.length) return false
  let dif = 0
  for (let i = 0; i < esperado.length; i++) dif |= recebido.charCodeAt(i) ^ esperado.charCodeAt(i)
  return dif === 0
}
