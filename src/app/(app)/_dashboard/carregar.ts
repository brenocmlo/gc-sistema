import {
  atrasosPorObra,
  execucoesPorEtapa,
  funilComercial,
  motivosDeRejeicao,
  ORCAMENTO_EM_ABERTO,
  progressoDasObras,
  receitaPorMes,
  ultimos12Meses,
  pendenciasDoPerfil,
  secoesDoPerfil,
  taxaDeConversao,
  type ExecucaoDoDashboard,
} from '@/lib/dashboard'
import type { createClient } from '@/lib/supabase/server'
import type { PagamentoDaEmpresa } from '@/lib/financeiro-empresa'
import type { NotaFiscalStatus, Perfil } from '@/lib/types'

import { carregarVisaoGeral, todas } from '../financeiro/visao-geral/carregar'

type Supabase = ReturnType<typeof createClient>

/** Só a contagem (`head`): o dashboard não precisa das linhas. */
async function contar(q: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count, error } = await q
  if (error) throw new Error(error.message)
  return count ?? 0
}

/**
 * Os números do dashboard (12.3). Cada seção só é consultada para o perfil
 * que a vê, e as pendências só para quem age sobre elas.
 */
export async function carregarDashboard(supabase: Supabase, perfil: Perfil, hoje: string) {
  const secoes = secoesDoPerfil(perfil)
  const ve = (s: (typeof secoes)[number]) => secoes.includes(s)
  const age = (perfis: readonly Perfil[]) => perfis.includes(perfil)
  const so = { count: 'exact', head: true } as const
  const orcamentos = () => supabase.from('orcamentos').select('id', so)
  const propostas = () => supabase.from('propostas').select('id', so)
  const documentos = () => supabase.from('documentos_processamento').select('id', so)

  const inicio12 = `${ultimos12Meses(hoje)[0]}-01`
  const [comercial, operacao, financeiro, receita, pendComercial, fdsVencidos] = await Promise.all([
    ve('comercial')
      ? Promise.all([
          contar(orcamentos().in('status', ORCAMENTO_EM_ABERTO)),
          contar(propostas().eq('status', 'enviada')),
          contar(propostas().eq('status', 'aprovada')),
          contar(propostas().eq('status', 'rejeitada')),
          contar(orcamentos()),
          contar(propostas().neq('status', 'rascunho')),
          contar(supabase.from('contratos').select('id', so)),
          todas((de, ate) => supabase.from('orcamentos').select('motivo_rejeicao').eq('status', 'rejeitado').order('id').range(de, ate)),
          todas((de, ate) => supabase.from('propostas').select('motivo_rejeicao').eq('status', 'rejeitada').order('id').range(de, ate)),
        ]).then(([orcamentosEmAberto, propostasEnviadas, aprovadas, rejeitadas, totalOrcamentos, propostasAoCliente, totalContratos, orcRejeitados, propRejeitadas]) => ({
          funil: funilComercial({ orcamentos: totalOrcamentos, propostas: propostasAoCliente, contratos: totalContratos }),
          motivos: motivosDeRejeicao(orcRejeitados as { motivo_rejeicao: string | null }[], propRejeitadas as { motivo_rejeicao: string | null }[]),
          orcamentosEmAberto,
          propostasEnviadas,
          aprovadas,
          decididas: aprovadas + rejeitadas,
          taxa: taxaDeConversao(aprovadas, rejeitadas),
        }))
      : null,
    ve('operacao')
      ? Promise.all([
          contar(supabase.from('obras').select('id', so).eq('status', 'ativa')),
          todas((de, ate) =>
            supabase
              .from('execucao')
              .select('quantidade_total, fab_qtd, ent_qtd, inst_qtd, med_qtd, fab_previsao_fim, ent_previsao_fim, inst_previsao_fim, med_previsao_fim, item:itens!inner(obra:obras!inner(id, codigo_obra, nome, status))')
              .eq('item.obra.status', 'ativa')
              .order('id')
              .range(de, ate),
          ),
        ]).then(([obrasAtivas, lidas]) => {
          const execucoes = lidas as ExecucaoDoDashboard[]
          return { obrasAtivas, execucoes: execucoes.length, porEtapa: execucoesPorEtapa(execucoes), atrasos: atrasosPorObra(execucoes, hoje), progresso: progressoDasObras(execucoes) }
        })
      : null,
    ve('financeiro') ? carregarVisaoGeral(supabase, { periodo: 'mes' }, hoje) : null,
    ve('financeiro')
      ? Promise.all([
          todas((de, ate) => supabase.from('pagamentos').select('data_pagamento, valor, origem, parcela:acordo_parcelas(acordo:acordos_pagamento(status))').gte('data_pagamento', inicio12).order('id').range(de, ate)),
          todas((de, ate) => supabase.from('notas_fiscais').select('data_emissao, status, valor_total').gte('data_emissao', inicio12).order('id').range(de, ate)),
        ]).then(([pg, nf]) => receitaPorMes(pg as PagamentoDaEmpresa[], nf as { data_emissao: string; status: NotaFiscalStatus; valor_total: number }[], hoje))
      : null,
    age(['admin', 'comercial'])
      ? Promise.all([
          contar(orcamentos().eq('status', 'pendente')),
          contar(propostas().eq('status', 'enviada').lt('data_validade', hoje)),
          contar(documentos().eq('status', 'REVISAO_HUMANA')),
          contar(documentos().eq('status', 'APROVADO').eq('conferencia', 'pendente')),
        ])
      : [0, 0, 0, 0],
    age(['admin', 'financeiro']) ? contar(supabase.from('fd').select('id', so).is('data_pagamento', null).lt('data_vencimento', hoje)) : 0,
  ])

  const [orcamentosPendentes, propostasVencidas, documentosEmRevisao, documentosAConferir] = pendComercial
  const pendencias = pendenciasDoPerfil(perfil, {
    orcamentosPendentes,
    propostasVencidas,
    documentosEmRevisao,
    documentosAConferir,
    atrasosDeExecucao: operacao?.atrasos ?? [],
    documentosFinanceirosVencidos: financeiro?.faixas.vencidas.quantidade ?? 0,
    fdsVencidos,
  })

  return {
    comercial,
    operacao,
    financeiro: financeiro ? { aReceber: financeiro.cards.aReceber, recebidoNoMes: financeiro.cards.recebidoNoPeriodo, inicio: financeiro.inicio, receita: receita ?? [] } : null,
    pendencias,
  }
}
