/**
 * Conciliação da importação da planilha legada (sprint 14, bloco 14.3), pura e
 * testada. Quem lê a planilha e consulta o banco é
 * `scripts/importacao/conciliar.mjs`; aqui fica só a comparação.
 *
 * Cada métrica tem até três fontes:
 *   - planilha: o que a planilha diz (contado pelos registros montados, ou
 *     lido da aba Resumo);
 *   - banco: o que ficou em gc-dev depois da importação;
 *   - referência: o número que a equipe deu no card (8 obras, R$ 627.959,83 de
 *     NF emitida…), quando existe.
 * A linha só está ok se todas as fontes presentes batem: contagem exata, valor
 * com tolerância de um centavo.
 */
import { formatCurrency } from './format.ts'

export type TipoMetrica = 'contagem' | 'moeda'

/** Tolerância de um centavo, para arredondamento de soma de numeric(14,2). */
export const TOLERANCIA_MOEDA = 0.01

export type Valor = number | string | null | undefined

export interface EntradaConciliacao {
  metrica: string
  /** Código da obra, ou null para o total. */
  obra: string | null
  tipo: TipoMetrica
  planilha?: Valor
  banco?: Valor
  esperado?: Valor
  /** Informativa: aparece no relatório, mas não reprova a conciliação. */
  informativa?: boolean
}

export interface LinhaConciliacao {
  metrica: string
  obra: string | null
  tipo: TipoMetrica
  planilha: number | null
  banco: number | null
  referencia: number | null
  /** banco − planilha; null se faltar um dos dois. */
  diferenca: number | null
  ok: boolean
  informativa: boolean
  /** Por que não bateu ('' quando ok). */
  motivo: string
}

function numero(v: Valor): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'string' ? Number(v) : v
  return Number.isFinite(n) ? n : null
}

const centavos = (v: number) => Math.round(v * 100) / 100

/** Duas fontes batem? Contagem exata; moeda dentro de um centavo. */
export function bate(a: number, b: number, tipo: TipoMetrica): boolean {
  if (tipo === 'contagem') return a === b
  // O epsilon cobre a imprecisão do ponto flutuante em cima do centavo.
  return Math.abs(centavos(a) - centavos(b)) <= TOLERANCIA_MOEDA + 1e-9
}

export function conciliarLinha(e: EntradaConciliacao): LinhaConciliacao {
  const planilha = numero(e.planilha)
  const banco = numero(e.banco)
  const referencia = numero(e.esperado)
  const motivos: string[] = []
  const fmt = (v: number) => formatarValor(v, e.tipo)

  if (planilha === null && banco === null) motivos.push('não está na planilha nem no banco')
  else if (banco === null) motivos.push('faltando no banco')
  else if (planilha === null) motivos.push('faltando na planilha')
  else if (!bate(planilha, banco, e.tipo)) motivos.push(`banco difere da planilha em ${fmt(banco - planilha)}`)

  if (referencia !== null) {
    if (planilha !== null && !bate(planilha, referencia, e.tipo)) motivos.push(`planilha difere da referência em ${fmt(planilha - referencia)}`)
    if (banco !== null && !bate(banco, referencia, e.tipo)) motivos.push(`banco difere da referência em ${fmt(banco - referencia)}`)
  }

  const diferenca = planilha !== null && banco !== null ? (e.tipo === 'moeda' ? centavos(banco - planilha) : banco - planilha) : null
  return {
    metrica: e.metrica,
    obra: e.obra,
    tipo: e.tipo,
    planilha,
    banco,
    referencia,
    diferenca,
    ok: motivos.length === 0,
    informativa: Boolean(e.informativa),
    motivo: motivos.join('; '),
  }
}

export function conciliar(entradas: readonly EntradaConciliacao[]): LinhaConciliacao[] {
  return entradas.map(conciliarLinha)
}

/**
 * Uma métrica por obra: junta as obras das três fontes. Obra que só existe de
 * um lado vira a linha "faltando no banco" (ou "na planilha"). As referências
 * por obra são opcionais: o card só dá o total.
 */
export function entradasPorObra(
  metrica: string,
  tipo: TipoMetrica,
  fontes: {
    planilha: Readonly<Record<string, Valor>>
    banco: Readonly<Record<string, Valor>>
    esperado?: Readonly<Record<string, Valor>>
  },
  opcoes: { informativa?: boolean } = {},
): EntradaConciliacao[] {
  const obras = Array.from(new Set([...Object.keys(fontes.planilha), ...Object.keys(fontes.banco), ...Object.keys(fontes.esperado ?? {})])).sort()
  return obras.map((obra) => ({
    metrica,
    obra,
    tipo,
    planilha: fontes.planilha[obra],
    banco: fontes.banco[obra],
    esperado: fontes.esperado?.[obra],
    informativa: opcoes.informativa,
  }))
}

/**
 * Status da NF: o calculado pelo trigger dos pagamentos contra o que a
 * planilha escreveu (já traduzido por `statusNfDaPlanilha`). "Atrasada" e "Em
 * aberto" viram emitida; uma emitida com pagamento parcial no banco também
 * bate, porque a planilha não tem como dizer "paga parcialmente".
 */
export function conferirStatusNf(planilha: string | null | undefined, banco: string | null | undefined): { ok: boolean; motivo: string } {
  if (!banco) return { ok: false, motivo: 'NF faltando no banco' }
  if (!planilha) return { ok: true, motivo: '' } // a planilha não diz; nada a conferir
  if (planilha === banco) return { ok: true, motivo: '' }
  if (planilha === 'emitida' && banco === 'paga_parcialmente') return { ok: true, motivo: '' }
  return { ok: false, motivo: `planilha diz ${planilha}, o banco calculou ${banco}` }
}

export interface ResumoConciliacao {
  linhas: number
  ok: number
  divergentes: number
  informativas_divergentes: number
  bateu: boolean
}

export function resumoDaConciliacao(linhas: readonly LinhaConciliacao[]): ResumoConciliacao {
  const divergentes = linhas.filter((l) => !l.ok && !l.informativa).length
  const informativas = linhas.filter((l) => !l.ok && l.informativa).length
  return {
    linhas: linhas.length,
    ok: linhas.filter((l) => l.ok).length,
    divergentes,
    informativas_divergentes: informativas,
    bateu: divergentes === 0,
  }
}

/** Valor para a tela do relatório: R$ para moeda, inteiro para contagem, "—" se faltar. */
export function formatarValor(v: number | null | undefined, tipo: TipoMetrica): string {
  if (v === null || v === undefined) return '—'
  if (tipo === 'contagem') return String(v)
  return formatCurrency(v).replace(/ /g, ' ')
}
