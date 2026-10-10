import { ETAPAS, etapaAtual, etapasAtrasadas, progressoAgregado, progressoGeralDaObra, type Etapa } from './execucao.ts'
import { contaNoRecebido, type PagamentoDaEmpresa } from './financeiro-empresa.ts'
import { MOTIVO_REJEICAO_LABELS } from './types.ts'
import type { MotivoRejeicao, NotaFiscalStatus, OrcamentoStatus, Perfil } from './types'

/**
 * As seções do dashboard (12.3). Cada uma é dos perfis que abrem as telas de
 * onde vêm os números — os mesmos dos guards de layout e do menu (nav.ts).
 * As tabelas são lidas por tenant, então é aqui que o perfil decide o que aparece.
 */
export type SecaoDashboard = 'comercial' | 'operacao' | 'financeiro'

export const PERFIS_DA_SECAO: Record<SecaoDashboard, readonly Perfil[]> = {
  comercial: ['admin', 'comercial', 'visualizador'],
  operacao: ['admin', 'producao', 'medicao', 'visualizador'],
  financeiro: ['admin', 'financeiro', 'visualizador'],
}

export function secoesDoPerfil(perfil: Perfil): SecaoDashboard[] {
  return (Object.keys(PERFIS_DA_SECAO) as SecaoDashboard[]).filter((s) => PERFIS_DA_SECAO[s].includes(perfil))
}

/** Orçamento ainda sem decisão: nem aprovado, nem rejeitado, nem expirado. */
export const ORCAMENTO_EM_ABERTO: readonly OrcamentoStatus[] = ['pendente', 'analise', 'enviado']

/**
 * Taxa de conversão das propostas: aprovadas sobre as decididas (aprovadas
 * mais rejeitadas). A enviada ainda não decidiu e o rascunho não foi ao
 * cliente, então nenhuma das duas entra. Null sem decisão nenhuma.
 */
export function taxaDeConversao(aprovadas: number, rejeitadas: number): number | null {
  const decididas = aprovadas + rejeitadas
  return decididas === 0 ? null : aprovadas / decididas
}

/** "62,5%"; sem decisão, "—". */
export function formatTaxa(taxa: number | null): string {
  if (taxa === null) return '—'
  return `${(Math.round(taxa * 1000) / 10).toLocaleString('pt-BR')}%`
}

export type ExecucaoDoDashboard = {
  quantidade_total: number
  fab_qtd: number
  ent_qtd: number
  inst_qtd: number
  med_qtd: number
  fab_previsao_fim: string | null
  ent_previsao_fim: string | null
  inst_previsao_fim: string | null
  med_previsao_fim: string | null
  item: { obra: { id: string; codigo_obra: string; nome: string } | null } | null
}

/**
 * Quantas execuções estão em cada etapa, pela `etapaAtual` — a mesma regra
 * do filtro de etapa do /execucao. A que ainda não começou conta na
 * fabricação (é a fila dela); a concluída nas quatro não conta em nenhuma.
 */
export function execucoesPorEtapa(linhas: readonly ExecucaoDoDashboard[]): Record<Etapa, number> {
  const contagem = Object.fromEntries(ETAPAS.map((e) => [e, 0])) as Record<Etapa, number>
  for (const l of linhas) {
    const etapa = etapaAtual(l)
    if (etapa) contagem[etapa] += 1
  }
  return contagem
}

export type AtrasoDaObra = { obraId: string; codigo: string; nome: string; execucoes: number }

/**
 * Execuções com alguma etapa de previsão vencida, por obra (a regra do
 * filtro "atrasados" do 7.5). A obra com mais atrasos primeiro; empate, pelo código.
 */
export function atrasosPorObra(linhas: readonly ExecucaoDoDashboard[], hoje: string): AtrasoDaObra[] {
  const porObra = new Map<string, AtrasoDaObra>()
  for (const l of linhas) {
    const obra = l.item?.obra
    if (!obra || etapasAtrasadas(l, hoje).length === 0) continue
    const atual = porObra.get(obra.id) ?? { obraId: obra.id, codigo: obra.codigo_obra, nome: obra.nome, execucoes: 0 }
    atual.execucoes += 1
    porObra.set(obra.id, atual)
  }
  return Array.from(porObra.values()).sort((a, b) => b.execucoes - a.execucoes || a.codigo.localeCompare(b.codigo))
}

export type Pendencia = { chave: string; rotulo: string; quantidade: number; href: string; detalhe?: string }

export type ContagensDePendencia = {
  orcamentosPendentes: number
  propostasVencidas: number
  documentosEmRevisao: number
  documentosAConferir: number
  atrasosDeExecucao: readonly AtrasoDaObra[]
  documentosFinanceirosVencidos: number
  fdsVencidos: number
}

/**
 * O que espera uma ação do usuário, pelo que o perfil dele pode fazer: o
 * comercial responde orçamento, proposta e documento da automação; produção
 * e medição apontam a execução; o financeiro cobra o vencido. O admin vê
 * todas. O visualizador não age, então não tem pendência. Só entra o que
 * tem quantidade, cada uma com o link para a tela já filtrada.
 */
export function pendenciasDoPerfil(perfil: Perfil, c: ContagensDePendencia): Pendencia[] {
  const age = (perfis: readonly Perfil[]) => perfis.includes(perfil)
  const lista: Pendencia[] = []
  if (age(['admin', 'comercial'])) {
    lista.push(
      { chave: 'orcamentos', rotulo: 'Orçamentos aguardando análise', quantidade: c.orcamentosPendentes, href: '/orcamentos?status=pendente' },
      { chave: 'propostas', rotulo: 'Propostas enviadas com a validade vencida', quantidade: c.propostasVencidas, href: '/propostas?vencidas=1' },
      { chave: 'revisao', rotulo: 'Documentos em revisão humana', quantidade: c.documentosEmRevisao, href: '/documentos?status=REVISAO_HUMANA' },
      { chave: 'conferir', rotulo: 'Documentos lançados a conferir', quantidade: c.documentosAConferir, href: '/documentos?status=A_CONFERIR' },
    )
  }
  if (age(['admin', 'producao', 'medicao'])) {
    for (const a of c.atrasosDeExecucao) {
      lista.push({
        chave: `execucao-${a.obraId}`,
        rotulo: `Execuções com prazo vencido em ${a.codigo}`,
        detalhe: a.nome,
        quantidade: a.execucoes,
        href: `/execucao?obra=${a.obraId}&atrasados=1`,
      })
    }
  }
  if (age(['admin', 'financeiro'])) {
    lista.push(
      { chave: 'vencidos', rotulo: 'NFs e parcelas vencidas', quantidade: c.documentosFinanceirosVencidos, href: '/financeiro/visao-geral' },
      { chave: 'fd', rotulo: 'FDs vencidos sem pagamento', quantidade: c.fdsVencidos, href: '/fd?status=vencido' },
    )
  }
  return lista.filter((p) => p.quantidade > 0)
}

export type Atalho = { rotulo: string; href: string }

/**
 * As ações mais frequentes de cada perfil. Só o que o perfil pode fazer:
 * criar é de quem escreve (as páginas de novo redirecionam os outros).
 */
const ATALHOS: Record<Perfil, readonly Atalho[]> = {
  admin: [
    { rotulo: 'Novo orçamento', href: '/orcamentos/novo' },
    { rotulo: 'Nova proposta', href: '/propostas/nova' },
    { rotulo: 'Execução', href: '/execucao' },
    { rotulo: 'Registrar pagamento', href: '/financeiro/pagamentos/novo' },
    { rotulo: 'Logs e auditoria', href: '/logs' },
  ],
  comercial: [
    { rotulo: 'Novo orçamento', href: '/orcamentos/novo' },
    { rotulo: 'Nova proposta', href: '/propostas/nova' },
    { rotulo: 'Nova obra', href: '/obras/nova' },
    { rotulo: 'Documentos recebidos', href: '/documentos' },
  ],
  producao: [
    { rotulo: 'Apontar execução', href: '/execucao' },
    { rotulo: 'Obras', href: '/obras' },
  ],
  medicao: [
    { rotulo: 'Apontar medição', href: '/execucao' },
    { rotulo: 'Obras', href: '/obras' },
  ],
  financeiro: [
    { rotulo: 'Registrar pagamento', href: '/financeiro/pagamentos/novo' },
    { rotulo: 'Nova nota fiscal', href: '/financeiro/notas-fiscais/novo' },
    { rotulo: 'Novo FD', href: '/fd/novo' },
    { rotulo: 'Visão geral', href: '/financeiro/visao-geral' },
  ],
  visualizador: [
    { rotulo: 'Visão geral do financeiro', href: '/financeiro/visao-geral' },
    { rotulo: 'Obras', href: '/obras' },
    { rotulo: 'Propostas', href: '/propostas' },
  ],
}

export function atalhosDoPerfil(perfil: Perfil): readonly Atalho[] {
  return ATALHOS[perfil]
}

// ============================================================
// Gráficos (12.4)
// ============================================================

const emCentavos = (v: number | string | null | undefined) => Math.round(Number(v ?? 0) * 100)

export type EtapaDoFunil = { etapa: string; quantidade: number; /** Sobre a etapa anterior, 0..100; null na primeira ou com a anterior zerada. */ conversao: number | null }

/**
 * O funil comercial: orçamentos recebidos → propostas que foram ao cliente
 * (tudo menos o rascunho) → contratos. Sem período, como a taxa de conversão
 * dos cards: é o histórico inteiro.
 */
export function funilComercial(c: { orcamentos: number; propostas: number; contratos: number }): EtapaDoFunil[] {
  const etapas = [
    { etapa: 'Orçamentos', quantidade: c.orcamentos },
    { etapa: 'Propostas enviadas', quantidade: c.propostas },
    { etapa: 'Contratos', quantidade: c.contratos },
  ]
  return etapas.map((e, i) => {
    const anterior = i === 0 ? 0 : etapas[i - 1].quantidade
    return { ...e, conversao: i === 0 || anterior === 0 ? null : Math.round((e.quantidade / anterior) * 1000) / 10 }
  })
}

/** O mês de `hoje` e os 11 anteriores, em YYYY-MM, do mais antigo para o mais recente. */
export function ultimos12Meses(hoje: string): string[] {
  const ano = Number(hoje.slice(0, 4)), mes = Number(hoje.slice(5, 7))
  return Array.from({ length: 12 }, (_, i) => {
    const t = ano * 12 + (mes - 1) - (11 - i)
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
  })
}

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** "2026-10" → "out/26". */
export function rotuloMesCurto(mes: string): string {
  return `${MESES_CURTOS[Number(mes.slice(5, 7)) - 1]}/${mes.slice(2, 4)}`
}

export type ReceitaDoMes = { mes: string; rotulo: string; recebido: number; faturado: number }

/**
 * Receita dos últimos 12 meses: o recebido (pagamentos, pela regra do
 * total_recebido: o arquivado das conversões fica de fora) e o faturado (NFs
 * não canceladas, pela emissão). Mês sem movimento aparece com zero.
 */
export function receitaPorMes(
  pagamentos: readonly Pick<PagamentoDaEmpresa, 'data_pagamento' | 'valor' | 'origem' | 'parcela'>[],
  nfs: readonly { data_emissao: string; status: NotaFiscalStatus; valor_total: number | string }[],
  hoje: string,
): ReceitaDoMes[] {
  const meses = ultimos12Meses(hoje)
  const rec = new Map(meses.map((m) => [m, 0])), fat = new Map(meses.map((m) => [m, 0]))
  for (const p of pagamentos) {
    const m = p.data_pagamento.slice(0, 7)
    if (rec.has(m) && contaNoRecebido(p)) rec.set(m, (rec.get(m) as number) + emCentavos(p.valor))
  }
  for (const n of nfs) {
    const m = n.data_emissao.slice(0, 7)
    if (fat.has(m) && n.status !== 'cancelada') fat.set(m, (fat.get(m) as number) + emCentavos(n.valor_total))
  }
  return meses.map((m) => ({ mes: m, rotulo: rotuloMesCurto(m), recebido: (rec.get(m) as number) / 100, faturado: (fat.get(m) as number) / 100 }))
}

export type ProgressoDaObra = { obraId: string; codigo: string; nome: string; execucoes: number; progresso: number }

/**
 * Progresso de cada obra ativa: a média das quatro etapas agregadas, a
 * mesma conta da aba Execução da obra (progressoGeralDaObra). A obra mais
 * atrasada (menor progresso) primeiro.
 */
export function progressoDasObras(linhas: readonly ExecucaoDoDashboard[]): ProgressoDaObra[] {
  const porObra = new Map<string, { obra: { id: string; codigo_obra: string; nome: string }; linhas: ExecucaoDoDashboard[] }>()
  for (const l of linhas) {
    const obra = l.item?.obra
    if (!obra) continue
    const g = porObra.get(obra.id) ?? { obra, linhas: [] }
    g.linhas.push(l)
    porObra.set(obra.id, g)
  }
  return Array.from(porObra.values())
    .map(({ obra, linhas: ls }) => ({ obraId: obra.id, codigo: obra.codigo_obra, nome: obra.nome, execucoes: ls.length, progresso: progressoGeralDaObra(progressoAgregado(ls)) }))
    .sort((a, b) => a.progresso - b.progresso || a.codigo.localeCompare(b.codigo))
}

export type MotivoDoGrafico = { motivo: string; rotulo: string; orcamentos: number; propostas: number }

/**
 * Por que se perde negócio: os motivos dos orçamentos rejeitados e das
 * propostas rejeitadas, lado a lado. Do mais frequente para o menos; o
 * rejeitado sem motivo (dado antigo) aparece como "Sem motivo".
 */
export function motivosDeRejeicao(
  orcamentos: readonly { motivo_rejeicao: string | null }[],
  propostas: readonly { motivo_rejeicao: string | null }[],
): MotivoDoGrafico[] {
  const m = new Map<string, MotivoDoGrafico>()
  const conta = (motivo: string | null, campo: 'orcamentos' | 'propostas') => {
    const k = motivo ?? 'sem_motivo'
    const atual = m.get(k) ?? { motivo: k, rotulo: MOTIVO_REJEICAO_LABELS[k as MotivoRejeicao] ?? (k === 'sem_motivo' ? 'Sem motivo' : k), orcamentos: 0, propostas: 0 }
    atual[campo] += 1
    m.set(k, atual)
  }
  orcamentos.forEach((o) => conta(o.motivo_rejeicao, 'orcamentos'))
  propostas.forEach((p) => conta(p.motivo_rejeicao, 'propostas'))
  return Array.from(m.values()).sort((a, b) => b.orcamentos + b.propostas - (a.orcamentos + a.propostas) || a.rotulo.localeCompare(b.rotulo))
}
