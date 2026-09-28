// Regras puras do relatório de medição por obra (bloco 8.4). Sem React: serve
// a rota do PDF e `node --test`.
//
// A execução guarda só o acumulado (`med_qtd`); o histórico vem de
// `execucao_medicoes` (migration 20260925120000), uma linha por mudança.
// Medido no período = soma das mudanças com data no período. Acumulado no fim
// do período = `med_qtd` de hoje menos as mudanças depois do fim.

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/

export type Periodo = { de: string; ate: string }

export type ExecucaoParaMedicao = {
  id: string
  item_id: string
  med_qtd: number
  valor_unit: number | null
  item: {
    numero: number | null
    tipo: string | null
    descricao: string | null
    quantidade: number | null
    unidade: string | null
  } | null
}

export type MudancaDeMedicao = {
  execucao_id: string
  data: string
  qtd_anterior: number
  qtd_nova: number
}

export type LinhaDaMedicao = {
  itemId: string
  numero: number | null
  descricao: string
  unidade: string
  contratada: number
  medidoPeriodo: number
  acumulado: number
  /** null quando as execuções do item têm valores unitários diferentes. */
  valorUnit: number | null
  valorPeriodo: number
  valorAcumulado: number
}

export type RelatorioDeMedicao = {
  linhas: LinhaDaMedicao[]
  totais: { valorPeriodo: number; valorAcumulado: number }
}

const milesimos = (v: number) => Math.round(v * 1000) / 1000
const centavos = (v: number) => Math.round(v * 100) / 100

/** Do dia 1 do mês de `hoje` até `hoje`: o período que o botão sugere. */
export function periodoPadrao(hoje: string): Periodo {
  return { de: `${hoje.slice(0, 7)}-01`, ate: hoje }
}

export function validarPeriodo(de: unknown, ate: unknown): { ok: true; periodo: Periodo } | { ok: false; error: string } {
  if (typeof de !== 'string' || typeof ate !== 'string' || !DATA_ISO.test(de) || !DATA_ISO.test(ate)) {
    return { ok: false, error: 'Informe o período com as duas datas' }
  }
  // Ida e volta: o Date aceita 31/02 e rola para março.
  const existe = (d: string) => {
    const t = Date.parse(`${d}T00:00:00Z`)
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d
  }
  if (!existe(de) || !existe(ate)) {
    return { ok: false, error: 'Data inválida no período' }
  }
  if (de > ate) return { ok: false, error: 'A data inicial é depois da final' }
  return { ok: true, periodo: { de, ate } }
}

/**
 * Uma linha por item (as várias execuções de um item somam), em ordem de
 * número, com o que foi medido no período e o acumulado até o fim dele.
 * Valor = quantidade × valor unitário de cada execução.
 */
export function montarRelatorioDeMedicao(
  execucoes: readonly ExecucaoParaMedicao[],
  historico: readonly MudancaDeMedicao[],
  periodo: Periodo,
): RelatorioDeMedicao {
  const porExecucao = new Map<string, { periodo: number; depois: number }>()
  for (const m of historico) {
    const delta = Number(m.qtd_nova) - Number(m.qtd_anterior)
    const acc = porExecucao.get(m.execucao_id) ?? { periodo: 0, depois: 0 }
    if (m.data >= periodo.de && m.data <= periodo.ate) acc.periodo += delta
    else if (m.data > periodo.ate) acc.depois += delta
    porExecucao.set(m.execucao_id, acc)
  }

  const porItem = new Map<string, LinhaDaMedicao & { valores: Set<number> }>()
  for (const e of execucoes) {
    const h = porExecucao.get(e.id) ?? { periodo: 0, depois: 0 }
    const medidoPeriodo = h.periodo
    const acumulado = Math.max(Number(e.med_qtd) - h.depois, 0)
    const vu = Number(e.valor_unit ?? 0)
    const linha =
      porItem.get(e.item_id) ??
      {
        itemId: e.item_id,
        numero: e.item?.numero ?? null,
        descricao: e.item?.descricao ?? e.item?.tipo ?? 'Item',
        unidade: e.item?.unidade ?? '',
        contratada: Number(e.item?.quantidade ?? 0),
        medidoPeriodo: 0,
        acumulado: 0,
        valorUnit: null,
        valorPeriodo: 0,
        valorAcumulado: 0,
        valores: new Set<number>(),
      }
    linha.medidoPeriodo += medidoPeriodo
    linha.acumulado += acumulado
    linha.valorPeriodo += medidoPeriodo * vu
    linha.valorAcumulado += acumulado * vu
    linha.valores.add(vu)
    porItem.set(e.item_id, linha)
  }

  const linhas = Array.from(porItem.values())
    .map(({ valores, ...l }) => ({
      ...l,
      contratada: milesimos(l.contratada),
      medidoPeriodo: milesimos(l.medidoPeriodo),
      acumulado: milesimos(l.acumulado),
      valorUnit: valores.size === 1 ? Array.from(valores)[0] : null,
      valorPeriodo: centavos(l.valorPeriodo),
      valorAcumulado: centavos(l.valorAcumulado),
    }))
    .sort((a, b) =>
      a.numero === b.numero
        ? a.descricao.localeCompare(b.descricao, 'pt-BR')
        : a.numero === null
          ? 1
          : b.numero === null
            ? -1
            : a.numero - b.numero,
    )

  return {
    linhas,
    totais: {
      valorPeriodo: centavos(linhas.reduce((s, l) => s + l.valorPeriodo, 0)),
      valorAcumulado: centavos(linhas.reduce((s, l) => s + l.valorAcumulado, 0)),
    },
  }
}
