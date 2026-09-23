'use server'

import { revalidatePath } from 'next/cache'

import { mensagemDeErroContrato } from '@/lib/contratos'
import { validarDesconto, validarSomaPct } from '@/lib/propostas'
import { createClient } from '@/lib/supabase/server'

import type { ContratoPayload } from '@/lib/contratos-form'

export type GerarContratoOpcoes = {
  /** Copia os itens da proposta para o contrato (o default da tela). */
  copiarItens: boolean
  /**
   * A "confirmação explícita" do bloco 6.2: sem ela, uma proposta que já
   * tem contrato vigente não gera outro.
   */
  confirmarDuplicado: boolean
}

export type GerarContratoResult =
  | { ok: true; id: string; numero: string }
  | {
      ok: false
      error: string
      /** Preenchido quando a recusa foi por já existir contrato vigente. */
      contratosExistentes?: string[]
    }

/**
 * Gera um contrato a partir de uma proposta aprovada (bloco 6.2).
 *
 * O trabalho de verdade é a função `gerar_contrato_de_proposta`
 * (20260923162000): insere o contrato e copia os itens na MESMA transação, e
 * confere por conta própria que a proposta está aprovada e que não há outro
 * contrato vigente dela. A action repete o que dá pra dizer antes de ir ao
 * banco (perfil, desconto, soma dos percentuais) e traduz as recusas.
 *
 * A obra do payload é ignorada: o contrato é sempre da obra da proposta, que
 * é o que a FK `contratos_proposta_fk` exige.
 */
export async function gerarContratoDeProposta(
  propostaId: string,
  input: ContratoPayload,
  opcoes: GerarContratoOpcoes,
): Promise<GerarContratoResult> {
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

  // O guard do layout de /propostas libera visualizador; a action não.
  if (profile.perfil !== 'admin' && profile.perfil !== 'comercial') {
    return { ok: false, error: 'Sem permissão pra gerar contratos' }
  }

  const numero = (input?.numero ?? '').trim()
  if (!numero) return { ok: false, error: 'Número do contrato obrigatório' }

  const desconto = validarDesconto(Number(input.valor_total ?? 0), Number(input.desconto ?? 0))
  // Com itens copiados o valor será a soma, e quem confere o desconto contra
  // ela é a função. Sem cópia, o valor é o do form, e dá pra recusar aqui.
  if (!opcoes?.copiarItens && !desconto.ok) return { ok: false, error: desconto.error }

  const soma = validarSomaPct(input)
  if (!soma.ok) return { ok: false, error: soma.error }

  const { data, error } = await supabase.rpc('gerar_contrato_de_proposta', {
    p_proposta: propostaId,
    p_contrato: {
      numero,
      descricao: input.descricao,
      data_assinatura: input.data_assinatura,
      prazo_execucao: input.prazo_execucao,
      valor_total: input.valor_total,
      desconto: input.desconto,
      pct_sinal: input.pct_sinal,
      pct_fd: input.pct_fd,
      pct_entrega_material: input.pct_entrega_material,
      pct_medicao_instalacao: input.pct_medicao_instalacao,
      condicoes_pagamento: input.condicoes_pagamento,
      observacao: input.observacao,
    },
    p_copiar_itens: opcoes?.copiarItens === true,
    p_confirmar_duplicado: opcoes?.confirmarDuplicado === true,
  })

  if (error) {
    if (error.message.includes('contrato_ja_gerado_da_proposta')) {
      // A tela já avisa antes de enviar; este caminho é o de duas pessoas
      // gerando ao mesmo tempo. Devolve os números pra tela pedir a
      // confirmação com eles.
      const { data: existentes } = await supabase
        .from('contratos')
        .select('numero')
        .eq('proposta_origem_id', propostaId)
        .neq('status', 'rescindido')
      return {
        ok: false,
        error: mensagemDeErroContrato(error.message),
        contratosExistentes: (existentes ?? []).map((c) => c.numero),
      }
    }
    return { ok: false, error: mensagemDeErroContrato(error.message) }
  }

  revalidatePath('/contratos')
  revalidatePath(`/propostas/${propostaId}`)
  return { ok: true, id: data as string, numero }
}
