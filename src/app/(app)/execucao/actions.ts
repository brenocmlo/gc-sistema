'use server'

import { revalidatePath } from 'next/cache'

import {
  mensagemDeErroExecucao,
  proximoSequencial,
  ETAPAS,
  validarCascata,
  validarPrevisoes,
  validarQuantidadeDaExecucao,
  validarReducaoDaExecucao,
  type ApontamentoPayload,
} from '@/lib/execucao'
import { createClient } from '@/lib/supabase/server'
import type { ExecucaoListItem } from '@/lib/types'

import { itensSemExecucao } from './queries'

/** Os perfis das policies "Execução: produção/medição/admin inserem/atualizam". */
const PERFIS_QUE_APONTAM = ['admin', 'producao', 'medicao']

export type CriarExecucoesResult =
  | { ok: true; criadas: number }
  | { ok: false; error: string }

/** Ação em lote do 7.2: cria a primeira execução de cada item que não tem. */
export async function criarExecucoesFaltantes(obraId: string): Promise<CriarExecucoesResult> {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Não autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('empresa_id, perfil')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile) return { ok: false, error: 'Perfil não configurado' }

  // O guard do layout protege a rota; a action repete por conta própria.
  if (!PERFIS_QUE_APONTAM.includes(profile.perfil)) {
    return { ok: false, error: 'Sem permissão pra criar execuções' }
  }
  if (!obraId) return { ok: false, error: 'Selecione uma obra' }

  // Relido do banco, e não do que a tela mostrou: entre abrir e confirmar,
  // alguém pode ter criado parte delas.
  const faltantes = await itensSemExecucao(supabase, obraId)
  if (faltantes.error) return { ok: false, error: faltantes.error }
  if (faltantes.ids.length === 0) return { ok: true, criadas: 0 }

  // quantidade_total e valor_unit vêm do item pelos triggers de INSERT
  // (execucao_set_quantidade_total e execucao_pull_valor_from_item).
  const { data, error } = await supabase
    .from('execucao')
    .insert(
      faltantes.ids.map((item_id) => ({
        empresa_id: profile.empresa_id,
        item_id,
        sequencial: 1,
        quantidade_total: 0,
      })),
    )
    .select('id')

  if (error) return { ok: false, error: mensagemDeErroExecucao(error.message) }

  revalidatePath('/execucao')
  return { ok: true, criadas: (data ?? []).length }
}

// ============================================================
// Apontamento (bloco 7.3)
// ============================================================

/** O mesmo select da listagem: a linha volta pronta para a tabela trocar. */
const SELECT_LINHA = '*, item:itens!inner(id, numero, tipo, descricao, quantidade, unidade, obra_id)'

export type ApontarResult =
  | { ok: true; execucao: ExecucaoListItem }
  | { ok: false; error: string; conflito?: boolean }

function textoOuNulo(v: unknown): string | null {
  const t = typeof v === 'string' ? v.trim() : ''
  return t === '' ? null : t.slice(0, 1000)
}

/**
 * Grava as quatro quantidades, os responsáveis e as observações de uma
 * execução. Datas e status NÃO vêm daqui: `*_status` é GENERATED e as datas
 * saem do trigger `execucao_preenche_datas`.
 *
 * `updatedAtVisto` é o `updated_at` que a tela tinha ao abrir o painel. Lock
 * otimista, como nos itens (5.3): se alguém apontou no meio, o update não casa
 * e a action devolve `conflito`, em vez de sobrescrever o apontamento alheio.
 */
export async function apontarExecucao(
  id: string,
  input: ApontamentoPayload,
  updatedAtVisto: string | null,
): Promise<ApontarResult> {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Não autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('perfil')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile) return { ok: false, error: 'Perfil não configurado' }

  if (!PERFIS_QUE_APONTAM.includes(profile.perfil)) {
    return { ok: false, error: 'Sem permissão pra apontar execução' }
  }

  const { data: atual, error: readErr } = await supabase
    .from('execucao')
    .select('item_id, quantidade_total, fab_previsao_fim, ent_previsao_fim, inst_previsao_fim, med_previsao_fim, item:itens!inner(quantidade)')
    .eq('id', id)
    .maybeSingle()
  if (readErr) return { ok: false, error: readErr.message }
  if (!atual) return { ok: false, error: 'Execução não encontrada' }

  // Previsões (7.5): a do corpo quando vem, a do banco quando não vem. A ordem
  // é conferida sobre o resultado final, que é o que fica gravado.
  const previsoes = Object.fromEntries(
    ETAPAS.map((etapa) => {
      const campo = `${etapa}_previsao_fim` as const
      const enviada = input?.[campo]
      return [etapa, enviada === undefined ? atual[campo] : textoOuNulo(enviada)]
    }),
  ) as Record<(typeof ETAPAS)[number], string | null>
  const ordemPrevisoes = validarPrevisoes(previsoes)
  if (!ordemPrevisoes.ok) return { ok: false, error: ordemPrevisoes.error }

  const q = {
    fab: Number(input?.fab_qtd),
    ent: Number(input?.ent_qtd),
    inst: Number(input?.inst_qtd),
    med: Number(input?.med_qtd),
  }

  // Quantidade da execução (7.4): sem valor no corpo, fica a do banco. Com
  // valor, tem de caber no item junto das outras execuções dele — regra de
  // aplicação, o banco não força (20260924110000).
  const total =
    input?.quantidade_total === undefined || input?.quantidade_total === null
      ? Number(atual.quantidade_total)
      : Number(input.quantidade_total)
  if (total !== Number(atual.quantidade_total)) {
    const { data: irmas } = await supabase
      .from('execucao')
      .select('quantidade_total')
      .eq('item_id', atual.item_id)
      .neq('id', id)
    const cabe = validarQuantidadeDaExecucao(
      total,
      Number((atual.item as { quantidade: number | null } | null)?.quantidade ?? 0),
      (irmas ?? []).map((e) => Number(e.quantidade_total)),
    )
    if (!cabe.ok) return { ok: false, error: cabe.error }
    const reducao = validarReducaoDaExecucao(total, q)
    if (!reducao.ok) return { ok: false, error: reducao.error }
  }

  const cascata = validarCascata(q.fab, q.ent, q.inst, q.med, total)
  if (!cascata.ok) return { ok: false, error: cascata.error }

  // Campos listados um a um: valor_unit, item_id, sequencial, empresa_id,
  // datas e evidências não vêm do corpo.
  let update = supabase
    .from('execucao')
    .update({
      quantidade_total: total,
      // Ausente no corpo, a localização fica como está (não vira nulo).
      ...(input.localizacao === undefined ? {} : { localizacao: textoOuNulo(input.localizacao) }),
      fab_previsao_fim: previsoes.fab,
      ent_previsao_fim: previsoes.ent,
      inst_previsao_fim: previsoes.inst,
      med_previsao_fim: previsoes.med,
      fab_qtd: q.fab,
      ent_qtd: q.ent,
      inst_qtd: q.inst,
      med_qtd: q.med,
      fab_responsavel: textoOuNulo(input.fab_responsavel),
      ent_responsavel: textoOuNulo(input.ent_responsavel),
      inst_responsavel: textoOuNulo(input.inst_responsavel),
      med_responsavel: textoOuNulo(input.med_responsavel),
      fab_observacao: textoOuNulo(input.fab_observacao),
      ent_observacao: textoOuNulo(input.ent_observacao),
      inst_observacao: textoOuNulo(input.inst_observacao),
      med_observacao: textoOuNulo(input.med_observacao),
    })
    .eq('id', id)
  if (updatedAtVisto) update = update.eq('updated_at', updatedAtVisto)

  const { data, error } = await update.select(SELECT_LINHA)
  if (error) return { ok: false, error: mensagemDeErroExecucao(error.message) }
  if (!data || data.length === 0) {
    return {
      ok: false,
      conflito: true,
      error:
        'Esta execução foi apontada por outra pessoa enquanto você editava. A linha foi recarregada — confira antes de repetir.',
    }
  }

  revalidatePath('/execucao')
  return { ok: true, execucao: data[0] as ExecucaoListItem }
}

export type LerExecucaoResult =
  | { ok: true; execucao: ExecucaoListItem }
  | { ok: false; error: string }

/** Os perfis do layout de /execucao: quem vê a tela pode reler uma linha dela. */
const PERFIS_QUE_VEEM = ['admin', 'producao', 'medicao', 'visualizador']

/**
 * A linha atual, para a tela recarregar depois de um conflito. A RLS de
 * select é por empresa, e deixaria o comercial (que não entra em /execucao)
 * ler a execução por aqui — então a action repete a lista do layout.
 */
export async function lerExecucao(id: string): Promise<LerExecucaoResult> {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Não autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('perfil')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile || !PERFIS_QUE_VEEM.includes(profile.perfil)) {
    return { ok: false, error: 'Sem permissão pra ver a execução' }
  }

  const { data, error } = await supabase.from('execucao').select(SELECT_LINHA).eq('id', id).maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'Execução não encontrada' }
  return { ok: true, execucao: data as ExecucaoListItem }
}

// ============================================================
// Nova execução para um item (bloco 7.4)
// ============================================================

export type NovaExecucaoResult =
  | { ok: true; id: string; sequencial: number }
  | { ok: false; error: string }

/**
 * Mais uma execução de um item que já tem outra (Torre B, 2º pavimento). O
 * sequencial é o próximo do item, e a quantidade tem de caber no que as outras
 * execuções deixaram — por isso a primeira costuma precisar ser reduzida antes.
 */
export async function criarNovaExecucao(
  itemId: string,
  input: { quantidade: number; localizacao: string | null },
): Promise<NovaExecucaoResult> {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Não autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('empresa_id, perfil')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile) return { ok: false, error: 'Perfil não configurado' }

  if (!PERFIS_QUE_APONTAM.includes(profile.perfil)) {
    return { ok: false, error: 'Sem permissão pra criar execuções' }
  }

  const [{ data: item, error: itemErr }, { data: irmas, error: irmasErr }] = await Promise.all([
    supabase
      .from('itens')
      .select('id, quantidade, contrato_id, contrato:contratos(status)')
      .eq('id', itemId)
      .maybeSingle(),
    supabase.from('execucao').select('sequencial, quantidade_total').eq('item_id', itemId),
  ])
  const erro = itemErr ?? irmasErr
  if (erro) return { ok: false, error: erro.message }
  if (!item) return { ok: false, error: 'Item não encontrado' }

  // A mesma regra da ação em lote do 7.2: execução é de item de contrato
  // que não foi rescindido.
  const contrato = item.contrato as { status: string } | null
  if (!item.contrato_id || contrato?.status === 'rescindido') {
    return { ok: false, error: 'Só item de contrato vigente recebe execução' }
  }

  const cabe = validarQuantidadeDaExecucao(
    Number(input?.quantidade),
    Number(item.quantidade ?? 0),
    (irmas ?? []).map((e) => Number(e.quantidade_total)),
  )
  if (!cabe.ok) return { ok: false, error: cabe.error }

  const sequencial = proximoSequencial((irmas ?? []).map((e) => e.sequencial))

  // O unique (item_id, sequencial) segura duas criações simultâneas: a
  // segunda recebe a mensagem de sequencial repetido e pode tentar de novo.
  const { data, error } = await supabase
    .from('execucao')
    .insert({
      empresa_id: profile.empresa_id,
      item_id: itemId,
      sequencial,
      quantidade_total: Number(input.quantidade),
      localizacao: textoOuNulo(input.localizacao),
    })
    .select('id, sequencial')
    .single()

  if (error) return { ok: false, error: mensagemDeErroExecucao(error.message) }

  revalidatePath('/execucao')
  return { ok: true, id: data.id, sequencial: data.sequencial }
}
