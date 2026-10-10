import Link from 'next/link'
import { redirect } from 'next/navigation'

import { atalhosDoPerfil, formatTaxa } from '@/lib/dashboard'
import { ETAPA_LABELS, ETAPAS, hojeISO } from '@/lib/execucao'
import { formatCurrency, formatDate } from '@/lib/format'
import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'
import { PERFIL_LABELS } from '@/lib/types'

import { carregarDashboard } from './_dashboard/carregar'
import { GraficoFunil, GraficoMotivos, GraficoProgresso, GraficoReceita } from './_dashboard/graficos'

type Card = { rotulo: string; valor: string; nota: string; href?: string }

/** Colunas da faixa de indicadores no desktop, pelo número de indicadores (classes literais pro Tailwind). */
const COLUNAS_LG: Record<number, string> = { 1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5' }

/**
 * Seção do dashboard: a faixa de indicadores e, abaixo, os gráficos.
 * Indicador não é botão: os números ficam num painel só, separados por
 * divisórias (borda de cima e da esquerda de cada célula; o painel corta as
 * da borda), e o caminho para o detalhe é um link discreto "Ver", não o
 * cartão inteiro clicável.
 */
function Secao({ titulo, cards, children }: { titulo: string; cards: Card[]; children?: React.ReactNode }) {
  return (
    <section aria-label={titulo} className="space-y-3">
      <h2 className="text-sm font-semibold text-gray-900">{titulo}</h2>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <dl className={`grid grid-cols-2 ${COLUNAS_LG[cards.length] ?? 'lg:grid-cols-4'} -mt-px -ml-px`}>
          {cards.map((c) => (
            <div key={c.rotulo} data-card={c.rotulo} className="border-t border-l border-gray-100 px-4 py-3 min-w-0">
              <dt className="text-xs font-medium text-gray-500">{c.rotulo}</dt>
              <dd className="text-2xl font-semibold text-gray-900 tabular-nums mt-1">{c.valor}</dd>
              <dd className="text-xs text-gray-500 mt-0.5">{c.nota}</dd>
              {c.href && (
                <dd className="mt-1.5">
                  <Link href={c.href} className="text-xs font-medium text-blue-700 hover:text-blue-900 hover:underline underline-offset-2">
                    Ver<span aria-hidden="true"> →</span>
                    <span className="sr-only"> {c.rotulo.toLowerCase()}</span>
                  </Link>
                </dd>
              )}
            </div>
          ))}
        </dl>
      </div>
      {children}
    </section>
  )
}

/**
 * Moldura de um gráfico (12.4): título, a leitura em uma linha e, para leitor
 * de tela e para quem quer o número exato, a tabela dos dados.
 */
function Grafico({ titulo, nota, vazio, tabela, children }: { titulo: string; nota: string; vazio: string | null; tabela: { cabecalho: string[]; linhas: (string | number)[][] }; children: React.ReactNode }) {
  return (
    <figure aria-label={titulo} data-grafico={titulo} className="bg-white rounded-lg border border-gray-200 p-4 space-y-2 min-w-0">
      <figcaption>
        <p className="text-sm font-semibold text-gray-900">{titulo}</p>
        <p className="text-xs text-gray-500">{nota}</p>
      </figcaption>
      {vazio ? <p className="text-sm text-gray-500 py-6">{vazio}</p> : children}
      {/* sr-only no div, não na tabela: tabela ignora o width de 1px e esticava a página em 390px */}
      <div className="sr-only">
        <table>
          <thead><tr>{tabela.cabecalho.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{tabela.linhas.map((l, i) => <tr key={i}>{l.map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </figure>
  )
}

/** Dashboard (12.3): os números de cada frente, as pendências e os atalhos do perfil. */
export default async function DashboardPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')

  const hoje = hojeISO()
  const d = await carregarDashboard(createClient(), profile.perfil, hoje)
  const atalhos = atalhosDoPerfil(profile.perfil)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-base font-semibold text-gray-900">{`Olá, ${profile.nome}`}</p>
          <p className="text-xs text-gray-500">{`${PERFIL_LABELS[profile.perfil]} · ${formatDate(hoje)}`}</p>
        </div>
        <nav aria-label="Atalhos" className="flex flex-wrap gap-2">
          {atalhos.map((a) => (
            <Link key={a.href} href={a.href} className="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">
              {a.rotulo}
            </Link>
          ))}
        </nav>
      </div>

      <section aria-label="Pendências" className="bg-white rounded-lg border border-gray-200 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900 pb-2 border-b border-gray-200">{`Suas pendências (${d.pendencias.length})`}</h2>
        {profile.perfil === 'visualizador' ? (
          <p className="text-sm text-gray-500">O perfil de consulta não tem pendências de ação.</p>
        ) : d.pendencias.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhuma pendência no momento.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {d.pendencias.map((p) => (
              <li key={p.chave} data-pendencia={p.chave}>
                <Link href={p.href} className="flex items-center justify-between gap-3 py-2 text-sm hover:bg-gray-50">
                  <span className="min-w-0">
                    <span className="text-gray-900">{p.rotulo}</span>
                    {p.detalhe && <span className="block text-xs text-gray-500 truncate">{p.detalhe}</span>}
                  </span>
                  <span className="shrink-0 rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-xs font-semibold">{p.quantidade}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {d.comercial && (
        <Secao
          titulo="Funil comercial"
          cards={[
            { rotulo: 'Orçamentos em aberto', valor: String(d.comercial.orcamentosEmAberto), nota: 'pendentes, em análise e enviados', href: '/orcamentos' },
            { rotulo: 'Propostas enviadas', valor: String(d.comercial.propostasEnviadas), nota: 'aguardando a decisão do cliente', href: '/propostas?status=enviada' },
            { rotulo: 'Taxa de conversão', valor: formatTaxa(d.comercial.taxa), nota: `${d.comercial.aprovadas} aprovada(s) de ${d.comercial.decididas} decidida(s)` },
          ]}
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Grafico
              titulo="Funil comercial"
              nota="Orçamentos recebidos, propostas que foram ao cliente e contratos, desde o início; o % é sobre a etapa anterior"
              vazio={d.comercial.funil[0].quantidade === 0 ? 'Nenhum orçamento ainda.' : null}
              tabela={{ cabecalho: ['Etapa', 'Quantidade', '% da etapa anterior'], linhas: d.comercial.funil.map((e) => [e.etapa, e.quantidade, e.conversao === null ? '—' : `${e.conversao}%`]) }}
            >
              <GraficoFunil dados={d.comercial.funil} />
            </Grafico>
            <Grafico
              titulo="Motivos de rejeição"
              nota="Orçamentos e propostas rejeitados, por motivo"
              vazio={d.comercial.motivos.length === 0 ? 'Nenhuma rejeição registrada.' : null}
              tabela={{ cabecalho: ['Motivo', 'Orçamentos', 'Propostas'], linhas: d.comercial.motivos.map((m) => [m.rotulo, m.orcamentos, m.propostas]) }}
            >
              <GraficoMotivos dados={d.comercial.motivos} />
            </Grafico>
          </div>
        </Secao>
      )}

      {d.operacao && (
        <Secao
          titulo="Operação"
          cards={[
            { rotulo: 'Obras ativas', valor: String(d.operacao.obrasAtivas), nota: `${d.operacao.execucoes} execução(ões) nelas`, href: '/obras?status=ativa' },
            ...ETAPAS.map((etapa) => ({
              rotulo: `Em ${ETAPA_LABELS[etapa].toLowerCase()}`,
              valor: String(d.operacao!.porEtapa[etapa]),
              nota: 'execuções nesta etapa',
            })),
          ]}
        >
          <Grafico
            titulo="Progresso das obras ativas"
            nota="Média das quatro etapas, como na aba Execução da obra; a menos adiantada primeiro"
            vazio={d.operacao.progresso.length === 0 ? 'Nenhuma obra ativa com execução.' : null}
            tabela={{ cabecalho: ['Obra', 'Nome', 'Execuções', 'Progresso'], linhas: d.operacao.progresso.map((o) => [o.codigo, o.nome, o.execucoes, `${o.progresso}%`]) }}
          >
            <GraficoProgresso dados={d.operacao.progresso} />
          </Grafico>
        </Secao>
      )}

      {d.financeiro && (
        <Secao
          titulo="Financeiro"
          cards={[
            { rotulo: 'A receber', valor: formatCurrency(d.financeiro.aReceber), nota: 'saldo pendente das obras', href: '/financeiro/visao-geral' },
            { rotulo: 'Recebido no mês', valor: formatCurrency(d.financeiro.recebidoNoMes), nota: d.financeiro.inicio ? `desde ${formatDate(d.financeiro.inicio)}` : '', href: '/financeiro/visao-geral' },
          ]}
        >
          <Grafico
            titulo="Receita por mês"
            nota="Faturado (NFs não canceladas, pela emissão) e recebido (pagamentos), nos últimos 12 meses"
            vazio={null}
            tabela={{ cabecalho: ['Mês', 'Faturado', 'Recebido'], linhas: d.financeiro.receita.map((m) => [m.rotulo, formatCurrency(m.faturado), formatCurrency(m.recebido)]) }}
          >
            <GraficoReceita dados={d.financeiro.receita} />
          </Grafico>
        </Secao>
      )}
    </div>
  )
}
