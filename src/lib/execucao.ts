// Regras puras da execução (sprint 7). SEM 'use client' e sem React, pra
// servirem Server Component, Server Action e Client Component, e pra serem
// cobertas por `node --test`.
//
// A cascata é forçada pelo banco (20260424121550, tabela `execucao`), com um
// CHECK por coluna:
//
//   fab_qtd  <= quantidade_total
//   ent_qtd  <= fab_qtd
//   inst_qtd <= ent_qtd
//   med_qtd  <= inst_qtd
//
// Aqui ela é repetida para a tela aplicar o limite no input e explicar o
// bloqueio antes do POST, e para a action recusar com mensagem legível em vez
// do erro cru do CHECK. Status e datas de cada etapa NÃO são calculados aqui:
// `*_status` é GENERATED e as datas vêm do trigger `execucao_preenche_datas`.
// `statusDaEtapa` só espelha a regra do GENERATED para a prévia na tela.

import type { EtapaStatus } from './types'

export const ETAPAS = ['fab', 'ent', 'inst', 'med'] as const
export type Etapa = (typeof ETAPAS)[number]

export const ETAPA_LABELS: Record<Etapa, string> = {
  fab: 'Fabricação',
  ent: 'Entrega',
  inst: 'Instalação',
  med: 'Medição',
}

/** "só é possível ENTREGAR 12 porque só 12 foram FABRICADOS" */
const INFINITIVO: Record<Etapa, string> = {
  fab: 'fabricar',
  ent: 'entregar',
  inst: 'instalar',
  med: 'medir',
}
const PARTICIPIO: Record<Etapa, { um: string; varios: string; passiva: string }> = {
  fab: { um: 'fabricado', varios: 'fabricados', passiva: 'fabricada' },
  ent: { um: 'entregue', varios: 'entregues', passiva: 'entregue' },
  inst: { um: 'instalado', varios: 'instalados', passiva: 'instalada' },
  med: { um: 'medido', varios: 'medidos', passiva: 'medida' },
}

export const STATUS_ETAPA_LABELS: Record<EtapaStatus, string> = {
  pendente: 'Pendente',
  andamento: 'Em andamento',
  concluido: 'Concluído',
}

/** Classes do selo e da barra de progresso de cada status. */
export const STATUS_ETAPA_CORES: Record<EtapaStatus, { selo: string; barra: string }> = {
  pendente: { selo: 'bg-gray-100 text-gray-600 border-gray-200', barra: 'bg-gray-300' },
  andamento: { selo: 'bg-yellow-100 text-yellow-700 border-yellow-200', barra: 'bg-yellow-500' },
  concluido: { selo: 'bg-green-100 text-green-700 border-green-200', barra: 'bg-green-600' },
}

export type QtdsEtapas = Record<Etapa, number>

/** As quatro quantidades de uma linha de `execucao`. */
export function qtdsDaExecucao(e: {
  fab_qtd: number
  ent_qtd: number
  inst_qtd: number
  med_qtd: number
}): QtdsEtapas {
  return { fab: e.fab_qtd, ent: e.ent_qtd, inst: e.inst_qtd, med: e.med_qtd }
}

/** numeric(10,3): compara em milésimos, sem ruído de ponto flutuante. */
function milesimos(v: number): number {
  return Math.round(v * 1000)
}

export function etapaAnterior(etapa: Etapa): Etapa | null {
  const i = ETAPAS.indexOf(etapa)
  return i > 0 ? ETAPAS[i - 1] : null
}

export function proximaEtapa(etapa: Etapa): Etapa | null {
  const i = ETAPAS.indexOf(etapa)
  return i < ETAPAS.length - 1 ? ETAPAS[i + 1] : null
}

/**
 * Espelha o GENERATED de `*_status`: 0 é pendente, a partir do total é
 * concluído, no meio é andamento.
 */
export function statusDaEtapa(qtd: number, total: number): EtapaStatus {
  if (milesimos(qtd) === 0) return 'pendente'
  if (milesimos(qtd) >= milesimos(total)) return 'concluido'
  return 'andamento'
}

/**
 * Faixa permitida para uma etapa dado o estado atual das outras. O máximo é a
 * etapa anterior (ou o total, na fabricação); o mínimo é a etapa seguinte —
 * baixar a fabricação para menos do que já foi entregue quebraria o CHECK de
 * `ent_qtd`.
 */
export function limitesDaEtapa(
  etapa: Etapa,
  qtds: QtdsEtapas,
  total: number,
): { min: number; max: number } {
  const anterior = etapaAnterior(etapa)
  const proxima = proximaEtapa(etapa)
  return {
    min: proxima ? qtds[proxima] : 0,
    max: anterior ? qtds[anterior] : total,
  }
}

/** O atalho "concluir etapa": o máximo que a cascata deixa naquela etapa. */
export function maximoDaEtapa(etapa: Etapa, qtds: QtdsEtapas, total: number): number {
  return limitesDaEtapa(etapa, qtds, total).max
}

export type ResultadoCascata =
  | { ok: true }
  | { ok: false; etapa: Etapa; error: string }

/** Quantidade em pt-BR, até 3 casas (a precisão de numeric(10,3)). */
export function formatQtd(v: number): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}

/**
 * "Só é possível entregar 12 porque só 12 foram fabricados", com a
 * concordância de nenhum, um e vários.
 */
function mensagemDeBloqueio(etapa: Etapa, anterior: Etapa | null, limite: number): string {
  if (!anterior) {
    return `Só é possível ${INFINITIVO[etapa]} ${formatQtd(limite)}: é a quantidade total do item`
  }
  const p = PARTICIPIO[anterior]
  if (milesimos(limite) === 0) {
    return `Não é possível ${INFINITIVO[etapa]} porque nenhuma unidade foi ${p.passiva}`
  }
  if (milesimos(limite) === 1000) {
    return `Só é possível ${INFINITIVO[etapa]} 1 porque só 1 foi ${p.um}`
  }
  return `Só é possível ${INFINITIVO[etapa]} ${formatQtd(limite)} porque só ${formatQtd(limite)} foram ${p.varios}`
}

/**
 * A cascata inteira, na ordem das etapas, parando no primeiro bloqueio. A
 * mensagem diz o limite e o porquê: "Só é possível entregar 12 porque só 12
 * foram fabricados".
 */
export function validarCascata(
  fab: number,
  ent: number,
  inst: number,
  med: number,
  total: number,
): ResultadoCascata {
  const qtds: QtdsEtapas = { fab, ent, inst, med }
  for (const etapa of ETAPAS) {
    const v = qtds[etapa]
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return { ok: false, etapa, error: `Quantidade de ${ETAPA_LABELS[etapa].toLowerCase()} inválida` }
    }
    if (milesimos(v) < 0) {
      return { ok: false, etapa, error: `Quantidade de ${ETAPA_LABELS[etapa].toLowerCase()} não pode ser negativa` }
    }
    if (Math.abs(v * 1000 - milesimos(v)) > 1e-6) {
      return { ok: false, etapa, error: 'Use no máximo 3 casas decimais' }
    }
  }
  for (const etapa of ETAPAS) {
    const anterior = etapaAnterior(etapa)
    const limite = anterior ? qtds[anterior] : total
    if (milesimos(qtds[etapa]) > milesimos(limite)) {
      return { ok: false, etapa, error: mensagemDeBloqueio(etapa, anterior, limite) }
    }
  }
  return { ok: true }
}

/** Percentual de uma etapa (0..100, duas casas). Total zero é 0%. */
export function progressoEtapa(qtd: number, total: number): number {
  if (!(total > 0)) return 0
  return Math.round(Math.min(qtd / total, 1) * 10_000) / 100
}

/**
 * Progresso geral de uma execução: a média das quatro etapas. Cada etapa
 * pesa igual — "metade fabricado, nada entregue" dá 12,5%, e só a medição
 * completa leva a 100%.
 */
export function progressoGeral(qtds: QtdsEtapas, total: number): number {
  const soma = ETAPAS.reduce((acc, e) => acc + progressoEtapa(qtds[e], total), 0)
  return Math.round((soma / ETAPAS.length) * 100) / 100
}

/**
 * Percentual de cada etapa sobre várias execuções (o totalizador da obra no
 * 7.2): soma das quantidades da etapa sobre a soma dos totais.
 */
export function progressoAgregado(
  execucoes: readonly {
    quantidade_total: number
    fab_qtd: number
    ent_qtd: number
    inst_qtd: number
    med_qtd: number
  }[],
): QtdsEtapas {
  const total = execucoes.reduce((acc, e) => acc + (e.quantidade_total || 0), 0)
  const soma = (etapa: Etapa) =>
    execucoes.reduce((acc, e) => acc + (qtdsDaExecucao(e)[etapa] || 0), 0)
  return {
    fab: progressoEtapa(soma('fab'), total),
    ent: progressoEtapa(soma('ent'), total),
    inst: progressoEtapa(soma('inst'), total),
    med: progressoEtapa(soma('med'), total),
  }
}

/** Constraint do Postgres → mensagem de quem aponta. */
export function mensagemDeErroExecucao(raw: string): string {
  if (raw.includes('execucao_fab_qtd_check')) {
    return 'A fabricação não pode passar da quantidade total do item'
  }
  if (raw.includes('execucao_ent_qtd_check')) {
    return 'A entrega não pode passar do que foi fabricado'
  }
  if (raw.includes('execucao_inst_qtd_check')) {
    return 'A instalação não pode passar do que foi entregue'
  }
  if (raw.includes('execucao_med_qtd_check')) {
    return 'A medição não pode passar do que foi instalado'
  }
  if (raw.includes('execucao_quantidade_total_check')) {
    return 'Quantidade total inválida'
  }
  if (raw.includes('idx_execucao_item_sequencial')) {
    return 'Já existe uma execução com esse sequencial para o item'
  }
  if (raw.includes('execucao_item_fk')) {
    return 'Item inválido para esta empresa'
  }
  if (raw.includes('apenas admin ou financeiro pode alterar valor_unit')) {
    return 'Só admin ou financeiro altera o valor unitário da execução'
  }
  return raw
}

// ============================================================
// Listagem por obra (bloco 7.2)
// ============================================================
//
// A tela lê TODAS as execuções da obra de uma vez e filtra, ordena e pagina
// aqui. Dois motivos: o totalizador do topo precisa da obra inteira, filtrada
// ou não; e "etapa mais atrasada" é derivada das quatro quantidades, coisa que
// o PostgREST não ordena. Uma obra tem dezenas a poucas centenas de
// execuções — abaixo do teto de 1000 linhas do PostgREST, que a page confere.

type LinhaDeExecucao = {
  quantidade_total: number
  fab_qtd: number
  ent_qtd: number
  inst_qtd: number
  med_qtd: number
  fab_responsavel: string | null
  ent_responsavel: string | null
  inst_responsavel: string | null
  med_responsavel: string | null
  sequencial: number
  item: { numero: number | null; descricao: string | null; tipo: string | null } | null
  fab_previsao_fim?: string | null
  ent_previsao_fim?: string | null
  inst_previsao_fim?: string | null
  med_previsao_fim?: string | null
}

/**
 * A etapa em que a execução está: a primeira que não foi concluída. Com as
 * quatro concluídas, `null` — a execução acabou.
 */
export function etapaAtual(e: Pick<LinhaDeExecucao, 'quantidade_total' | 'fab_qtd' | 'ent_qtd' | 'inst_qtd' | 'med_qtd'>): Etapa | null {
  const q = qtdsDaExecucao(e)
  return ETAPAS.find((etapa) => statusDaEtapa(q[etapa], e.quantidade_total) !== 'concluido') ?? null
}

/**
 * Status da execução inteira: pendente se nada foi fabricado, concluído se
 * tudo foi medido, andamento no meio. Item de quantidade zero conta como
 * pendente — não há o que fazer, e ele não pode aparecer como concluído.
 */
export function statusGeral(e: Pick<LinhaDeExecucao, 'quantidade_total' | 'fab_qtd' | 'med_qtd'>): EtapaStatus {
  if (milesimos(e.fab_qtd) === 0) return 'pendente'
  if (statusDaEtapa(e.med_qtd, e.quantidade_total) === 'concluido') return 'concluido'
  return 'andamento'
}

export function isEtapa(v: string): v is Etapa {
  return (ETAPAS as readonly string[]).includes(v)
}

export function isEtapaStatus(v: string): v is EtapaStatus {
  return v === 'pendente' || v === 'andamento' || v === 'concluido'
}

export const ORDENS_EXECUCAO = ['numero', 'atraso'] as const
export type OrdemExecucao = (typeof ORDENS_EXECUCAO)[number]

export function isOrdemExecucao(v: string): v is OrdemExecucao {
  return (ORDENS_EXECUCAO as readonly string[]).includes(v)
}

export type FiltrosExecucao = {
  /** Etapa em que a execução está (`etapaAtual`). */
  etapa?: Etapa | ''
  status?: EtapaStatus | ''
  /** Nome do responsável, em qualquer uma das quatro etapas. */
  responsavel?: string
  /** Trecho da descrição (ou do tipo) do item, sem diferenciar maiúsculas e acentos. */
  busca?: string
  /** Só execuções com alguma etapa atrasada (7.5). `hoje` em YYYY-MM-DD. */
  atrasados?: boolean
  hoje?: string
}

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function responsaveisDaLinha(e: LinhaDeExecucao): string[] {
  return [e.fab_responsavel, e.ent_responsavel, e.inst_responsavel, e.med_responsavel]
    .map((r) => (r ?? '').trim())
    .filter(Boolean)
}

/** Nomes distintos de responsável na obra, em ordem alfabética — o select do filtro. */
export function responsaveisDe(linhas: readonly LinhaDeExecucao[]): string[] {
  const nomes = new Set(linhas.flatMap(responsaveisDaLinha))
  return Array.from(nomes).sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

export function filtrarExecucoes<T extends LinhaDeExecucao>(linhas: readonly T[], f: FiltrosExecucao): T[] {
  const busca = semAcento((f.busca ?? '').trim())
  return linhas.filter((e) => {
    if (f.etapa && etapaAtual(e) !== f.etapa) return false
    if (f.status && statusGeral(e) !== f.status) return false
    if (f.responsavel && !responsaveisDaLinha(e).includes(f.responsavel)) return false
    if (busca) {
      const texto = semAcento(`${e.item?.descricao ?? ''} ${e.item?.tipo ?? ''}`)
      if (!texto.includes(busca)) return false
    }
    if (f.atrasados && etapasAtrasadas(e, f.hoje ?? hojeISO()).length === 0) return false
    return true
  })
}

/** Posição da etapa atual na cascata: fabricação é a mais atrasada, concluída vai por último. */
function posicaoDoAtraso(e: LinhaDeExecucao): number {
  const atual = etapaAtual(e)
  return atual ? ETAPAS.indexOf(atual) : ETAPAS.length
}

function porNumero(a: LinhaDeExecucao, b: LinhaDeExecucao): number {
  // Item sem número inteiro vai para o fim, como na aba Itens.
  const na = a.item?.numero ?? Number.POSITIVE_INFINITY
  const nb = b.item?.numero ?? Number.POSITIVE_INFINITY
  if (na !== nb) return na < nb ? -1 : 1
  return a.sequencial - b.sequencial
}

/**
 * `numero`: a ordem do documento (número do item, depois o sequencial).
 * `atraso`: a mais atrasada primeiro. Antes da etapa em que está (parada na
 * fabricação vem antes de parada na instalação); na mesma etapa, a de menor
 * progresso naquela etapa; empate, pelo número. Desde o 7.5, antes de tudo
 * isso vem quem tem previsão vencida, a mais antiga primeiro.
 */
export function ordenarExecucoes<T extends LinhaDeExecucao>(
  linhas: readonly T[],
  ordem: OrdemExecucao,
  hoje: string = hojeISO(),
): T[] {
  const copia = [...linhas]
  if (ordem === 'numero') return copia.sort(porNumero)
  return copia.sort((a, b) => {
    // 7.5: previsão vencida vem antes de tudo, a mais antiga primeiro.
    const va = previsaoVencidaMaisAntiga(a, hoje)
    const vb = previsaoVencidaMaisAntiga(b, hoje)
    if (va !== vb) {
      if (va === null) return 1
      if (vb === null) return -1
      return va < vb ? -1 : 1
    }
    const pa = posicaoDoAtraso(a)
    const pb = posicaoDoAtraso(b)
    if (pa !== pb) return pa - pb
    if (pa < ETAPAS.length) {
      const etapa = ETAPAS[pa]
      const ga = progressoEtapa(qtdsDaExecucao(a)[etapa], a.quantidade_total)
      const gb = progressoEtapa(qtdsDaExecucao(b)[etapa], b.quantidade_total)
      if (ga !== gb) return ga - gb
    }
    return porNumero(a, b)
  })
}

// ============================================================
// Apontamento (bloco 7.3)
// ============================================================

/**
 * Valida UMA etapa, a que a pessoa está editando, contra as outras. Diferente
 * de `validarCascata`, que atribui o bloqueio à etapa de baixo: se a pessoa
 * baixa a fabricação para menos do que já foi entregue, a mensagem tem de
 * aparecer na fabricação, que é o campo que ela mexeu.
 */
export function validarEtapa(
  etapa: Etapa,
  valor: number,
  qtds: QtdsEtapas,
  total: number,
): { ok: true } | { ok: false; error: string } {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) {
    return { ok: false, error: 'Informe um número' }
  }
  if (milesimos(valor) < 0) return { ok: false, error: 'Não pode ser negativa' }
  if (Math.abs(valor * 1000 - milesimos(valor)) > 1e-6) {
    return { ok: false, error: 'Use no máximo 3 casas decimais' }
  }
  const { min, max } = limitesDaEtapa(etapa, qtds, total)
  if (milesimos(valor) > milesimos(max)) {
    return { ok: false, error: mensagemDeBloqueio(etapa, etapaAnterior(etapa), max) }
  }
  if (milesimos(valor) < milesimos(min)) {
    const proxima = proximaEtapa(etapa) as Etapa
    const p = PARTICIPIO[proxima]
    const ja = milesimos(min) === 1000 ? `já foi ${p.um} 1` : `já foram ${p.varios} ${formatQtd(min)}`
    return {
      ok: false,
      error: `Não é possível baixar a ${ETAPA_LABELS[etapa].toLowerCase()} para ${formatQtd(valor)}: ${ja}`,
    }
  }
  return { ok: true }
}

/**
 * Os campos que o painel de apontamento grava — e só eles. `quantidade_total`
 * e `localizacao` são do 7.4: a execução de uma parte do item (Torre A)
 * ajusta a própria quantidade no mesmo painel.
 */
export type ApontamentoPayload = {
  /** Ausente: fica a do banco. */
  quantidade_total?: number | null
  /** Ausente: fica a do banco. */
  localizacao?: string | null
  /** Previsões de fim (7.5), YYYY-MM-DD ou nulo. Ausentes: ficam as do banco. */
  fab_previsao_fim?: string | null
  ent_previsao_fim?: string | null
  inst_previsao_fim?: string | null
  med_previsao_fim?: string | null
  fab_qtd: number
  ent_qtd: number
  inst_qtd: number
  med_qtd: number
  fab_responsavel: string | null
  ent_responsavel: string | null
  inst_responsavel: string | null
  med_responsavel: string | null
  fab_observacao: string | null
  ent_observacao: string | null
  inst_observacao: string | null
  med_observacao: string | null
}

// ============================================================
// Várias execuções por item (bloco 7.4)
// ============================================================
//
// Um item pode ser executado em partes (Torre A, Torre B), cada uma com a sua
// quantidade e as suas quatro etapas. O banco não força que a soma das partes
// caiba no item (20260924110000): a regra é daqui, e as actions a repetem.

/** O próximo sequencial do item: o maior + 1 (1 para o primeiro). */
export function proximoSequencial(sequenciais: readonly number[]): number {
  return sequenciais.length === 0 ? 1 : Math.max(...sequenciais) + 1
}

/**
 * A quantidade de uma execução (nova ou ajustada) tem de caber no que sobra do
 * item: `outras` são as quantidades das OUTRAS execuções do mesmo item.
 */
export function validarQuantidadeDaExecucao(
  quantidade: number,
  quantidadeDoItem: number,
  outras: readonly number[],
): { ok: true } | { ok: false; error: string } {
  if (typeof quantidade !== 'number' || !Number.isFinite(quantidade)) {
    return { ok: false, error: 'Informe a quantidade da execução' }
  }
  if (milesimos(quantidade) <= 0) return { ok: false, error: 'A quantidade da execução tem de ser maior que zero' }
  if (Math.abs(quantidade * 1000 - milesimos(quantidade)) > 1e-6) {
    return { ok: false, error: 'Use no máximo 3 casas decimais' }
  }
  const usada = outras.reduce((acc, q) => acc + milesimos(q), 0)
  const sobra = milesimos(quantidadeDoItem) - usada
  if (milesimos(quantidade) > sobra) {
    return {
      ok: false,
      error:
        sobra <= 0
          ? `O item (${formatQtd(quantidadeDoItem)}) já está todo distribuído nas outras execuções. Reduza uma delas antes.`
          : `Só cabem ${formatQtd(sobra / 1000)} nesta execução: o item tem ${formatQtd(quantidadeDoItem)} e as outras execuções já somam ${formatQtd(usada / 1000)}`,
    }
  }
  return { ok: true }
}

/**
 * Reduzir a quantidade de uma execução não pode deixá-la abaixo do que já foi
 * fabricado — o CHECK `fab_qtd <= quantidade_total` recusaria.
 */
export function validarReducaoDaExecucao(
  quantidade: number,
  qtds: QtdsEtapas,
): { ok: true } | { ok: false; error: string } {
  if (milesimos(quantidade) < milesimos(qtds.fab)) {
    return {
      ok: false,
      error: `Já foram fabricados ${formatQtd(qtds.fab)} nesta execução; a quantidade dela não pode ficar abaixo disso`,
    }
  }
  return { ok: true }
}

export type ResumoDoItem = { execucoes: number; soma: number; quantidadeDoItem: number }

/**
 * Por item: quantas execuções ele tem e quanto elas somam. Alimenta o
 * agrupamento da listagem e o aviso de soma acima do item — que pode
 * acontecer quando a quantidade do item é reduzida depois (com várias
 * execuções, o banco não repartia a redução).
 */
export function resumoPorItem(
  linhas: readonly { item_id: string; quantidade_total: number; item: { quantidade: number | null } | null }[],
): Map<string, ResumoDoItem> {
  const mapa = new Map<string, ResumoDoItem>()
  for (const l of linhas) {
    const atual = mapa.get(l.item_id) ?? { execucoes: 0, soma: 0, quantidadeDoItem: l.item?.quantidade ?? 0 }
    atual.execucoes += 1
    atual.soma = (milesimos(atual.soma) + milesimos(l.quantidade_total)) / 1000
    mapa.set(l.item_id, atual)
  }
  return mapa
}

/** A soma das execuções passou da quantidade do item? */
export function somaAcimaDoItem(r: ResumoDoItem): boolean {
  return milesimos(r.soma) > milesimos(r.quantidadeDoItem)
}

// ============================================================
// Previsões e atrasos (bloco 7.5)
// ============================================================
//
// `*_previsao_fim` (migration 004) é a data em que a etapa deveria terminar.
// "Atrasada" é calculada aqui, em runtime, e não gravada: depende do dia.
// Datas em YYYY-MM-DD, comparadas como texto (a ordem é a mesma).

/** Hoje em YYYY-MM-DD, pelo mesmo relógio (UTC) do `current_date` do banco. */
export function hojeISO(): string {
  return new Date().toISOString().slice(0, 10)
}

type ComPrevisoes = Pick<LinhaDeExecucao, 'quantidade_total' | 'fab_qtd' | 'ent_qtd' | 'inst_qtd' | 'med_qtd'> & {
  fab_previsao_fim?: string | null
  ent_previsao_fim?: string | null
  inst_previsao_fim?: string | null
  med_previsao_fim?: string | null
}

export function previsaoDaEtapa(e: ComPrevisoes, etapa: Etapa): string | null {
  return (e[`${etapa}_previsao_fim`] as string | null | undefined) ?? null
}

/** A previsão passou (antes de hoje) e a etapa não foi concluída. Vencer hoje ainda não é atraso. */
export function etapaAtrasada(e: ComPrevisoes, etapa: Etapa, hoje: string): boolean {
  const previsao = previsaoDaEtapa(e, etapa)
  if (!previsao || previsao >= hoje) return false
  return statusDaEtapa(qtdsDaExecucao(e)[etapa], e.quantidade_total) !== 'concluido'
}

export function etapasAtrasadas(e: ComPrevisoes, hoje: string): Etapa[] {
  return ETAPAS.filter((etapa) => etapaAtrasada(e, etapa, hoje))
}

function previsaoVencidaMaisAntiga(e: ComPrevisoes, hoje: string): string | null {
  const vencidas = etapasAtrasadas(e, hoje).map((etapa) => previsaoDaEtapa(e, etapa) as string)
  return vencidas.length === 0 ? null : vencidas.sort()[0]
}

/** Dias corridos de `de` até `ate` (YYYY-MM-DD). Negativo se `ate` já passou. */
export function diasEntre(de: string, ate: string): number {
  const ms = Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

export type Vencimento<T> = { execucao: T; etapa: Etapa; previsao: string; dias: number }

/**
 * O painel de próximos vencimentos: etapas não concluídas com previsão entre
 * hoje e daqui a `janela` dias, da mais próxima para a mais distante. As já
 * vencidas não entram aqui: são o selo "Atrasada" e o filtro "só atrasados".
 */
export function proximosVencimentos<T extends ComPrevisoes>(
  linhas: readonly T[],
  hoje: string,
  janela = 7,
): Vencimento<T>[] {
  const out: Vencimento<T>[] = []
  for (const e of linhas) {
    for (const etapa of ETAPAS) {
      const previsao = previsaoDaEtapa(e, etapa)
      if (!previsao) continue
      if (statusDaEtapa(qtdsDaExecucao(e)[etapa], e.quantidade_total) === 'concluido') continue
      const dias = diasEntre(hoje, previsao)
      if (dias >= 0 && dias <= janela) out.push({ execucao: e, etapa, previsao, dias })
    }
  }
  return out.sort((a, b) => (a.previsao === b.previsao ? ETAPAS.indexOf(a.etapa) - ETAPAS.indexOf(b.etapa) : a.previsao < b.previsao ? -1 : 1))
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/

/**
 * As quatro previsões, opcionais, têm de ser datas válidas e seguir a ordem da
 * cascata: a entrega não pode estar prevista para antes da fabricação. Etapa
 * sem previsão não entra na comparação.
 */
export function validarPrevisoes(
  previsoes: Record<Etapa, string | null>,
): { ok: true } | { ok: false; etapa: Etapa; error: string } {
  let anterior: { etapa: Etapa; data: string } | null = null
  for (const etapa of ETAPAS) {
    const data = previsoes[etapa]
    if (!data) continue
    if (!DATA_ISO.test(data) || Number.isNaN(Date.parse(`${data}T00:00:00Z`))) {
      return { ok: false, etapa, error: `Previsão de ${ETAPA_LABELS[etapa].toLowerCase()} inválida` }
    }
    if (anterior && data < anterior.data) {
      return {
        ok: false,
        etapa,
        error: `A previsão de ${ETAPA_LABELS[etapa].toLowerCase()} não pode ser antes da de ${ETAPA_LABELS[anterior.etapa].toLowerCase()}`,
      }
    }
    anterior = { etapa, data }
  }
  return { ok: true }
}
