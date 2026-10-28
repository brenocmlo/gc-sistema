// Helpers puros das telas de Configurações → Bot (grupos, pedidos de acesso e
// situação dos usuários permitidos). Sem React, pra servir página, Server
// Action e teste por `node --test`.
import type { StatusGrupo, StatusPedido } from './bot-acesso.ts'

export const STATUS_GRUPO_LABELS: Record<StatusGrupo, string> = {
  PENDENTE: 'Aguardando liberação',
  LIBERADO: 'Liberado',
  BLOQUEADO: 'Bloqueado',
}

export const STATUS_PEDIDO_LABELS: Record<StatusPedido, string> = {
  PENDENTE: 'Pendente',
  APROVADO: 'Permitido',
  RECUSADO: 'Recusado',
}

export type GrupoBotListItem = {
  id: string
  nome: string | null
  telegram_chat_id: string
  status: StatusGrupo
  created_at: string
}

export type PedidoAcessoListItem = {
  id: string
  nome: string
  telegram_username: string | null
  telegram_user_id: string
  status: StatusPedido
  created_at: string
  grupo: { nome: string | null; telegram_chat_id: string } | null
}

/** Liberar vale para PENDENTE e BLOQUEADO; bloquear, para PENDENTE e LIBERADO. */
export function acoesDoGrupo(status: StatusGrupo): { liberar: boolean; bloquear: boolean } {
  return { liberar: status !== 'LIBERADO', bloquear: status !== 'BLOQUEADO' }
}

/** Permitir vale para PENDENTE e RECUSADO; recusar, só para PENDENTE. */
export function acoesDoPedido(status: StatusPedido): { permitir: boolean; recusar: boolean } {
  return { permitir: status === 'PENDENTE' || status === 'RECUSADO', recusar: status === 'PENDENTE' }
}

/** Pendentes primeiro; dentro de cada bloco, o mais recente em cima. Não muda o original. */
export function ordenarPedidos(pedidos: PedidoAcessoListItem[]): PedidoAcessoListItem[] {
  return [...pedidos].sort((a, b) => {
    const pa = a.status === 'PENDENTE' ? 0 : 1
    const pb = b.status === 'PENDENTE' ? 0 : 1
    if (pa !== pb) return pa - pb
    return b.created_at.localeCompare(a.created_at)
  })
}

export function rotuloSituacaoContato(ativo: boolean): 'Ativo' | 'Desativado' {
  return ativo ? 'Ativo' : 'Desativado'
}
