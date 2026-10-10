'use client'

import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import type { EtapaDoFunil, MotivoDoGrafico, ProgressoDaObra, ReceitaDoMes } from '@/lib/dashboard'
import { formatCurrency } from '@/lib/format'

// Paleta categórica de referência (skill dataviz), validada com
// validate_palette.js sobre o branco do cartão: azul e laranja passam
// claridade, croma, CVD (ΔE 24,7) e contraste ≥ 3:1. O cinza e o quase-preto
// de antes reprovavam (croma e claridade). Uma série só usa o azul.
const SERIE_1 = '#2a78d6'
const SERIE_2 = '#eb6834'
const GRADE = '#e5e7eb'
const EIXO = { fontSize: 12, fill: '#6b7280' }

/**
 * Entrada das barras (skill animate): só na carga do dashboard, que abre
 * algumas vezes ao dia — o propósito é a barra crescer da base em vez de
 * aparecer pronta. Ease-out forte, 450 ms, a segunda série 60 ms depois.
 * Com movimento reduzido no sistema, sem animação.
 */
const EASE_OUT = 'cubic-bezier(0.23,1,0.32,1)' as const
const DURACAO = 450
const ESCALONAMENTO = 60

function useMovimentoReduzido(): boolean {
  const [reduzido, setReduzido] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduzido(mq.matches)
    const mudar = (e: MediaQueryListEvent) => setReduzido(e.matches)
    mq.addEventListener('change', mudar)
    return () => mq.removeEventListener('change', mudar)
  }, [])
  return reduzido
}

/** Props de animação de uma série; `ordem` escalona a entrada. */
function animacao(reduzido: boolean, ordem = 0) {
  return reduzido
    ? { isAnimationActive: false }
    : { isAnimationActive: true, animationDuration: DURACAO, animationEasing: EASE_OUT, animationBegin: ordem * ESCALONAMENTO }
}

/** Barras finas (dataviz): no máximo 24 px; 2 px de vão entre as do mesmo grupo. */
const BARRA_MAX = 24

const reaisCurtos = (v: number) => (Math.abs(v) >= 1000 ? `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : `R$ ${v.toLocaleString('pt-BR')}`)

/**
 * Área do gráfico: o SVG fica em posição absoluta, então não entra na largura
 * mínima dos blocos de fora. Sem isso, o gráfico desenhado em 1440px
 * segurava a página larga quando a tela diminuía (o ResponsiveContainer nunca
 * recebia a largura menor). O overflow hidden cobre o intervalo até o
 * ResizeObserver redesenhar: o gráfico velho fica cortado no cartão, sem
 * alargar a página.
 */
function Area({ altura, children }: { altura: number; children: React.ReactElement }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: altura, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
      </div>
    </div>
  )
}

/** Rótulo de eixo com no máximo `n` caracteres; o texto inteiro fica no tooltip. */
const cortar = (n: number) => (v: string) => (v.length > n ? `${v.slice(0, n - 1)}…` : v)

/** Altura proporcional ao número de barras horizontais, com mínimo. */
const alturaDeBarras = (n: number) => Math.max(160, n * 44 + 40)

export function GraficoFunil({ dados }: { dados: EtapaDoFunil[] }) {
  const reduzido = useMovimentoReduzido()
  // Rótulo curto ao lado da barra; a explicação do % vai no tooltip e na nota do gráfico.
  const comRotulo = dados.map((d) => ({ ...d, rotulo: d.conversao === null ? String(d.quantidade) : `${d.quantidade} · ${d.conversao.toLocaleString('pt-BR')}%` }))
  return (
    <Area altura={alturaDeBarras(dados.length)}>
      <BarChart data={comRotulo} layout="vertical" margin={{ top: 4, right: 88, bottom: 4, left: 8 }}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey="etapa" width={120} tick={EIXO} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: '#f3f4f6' }} formatter={(v, _n, item) => [item.payload.conversao === null ? String(v) : `${v} (${item.payload.conversao.toLocaleString('pt-BR')}% da etapa anterior)`, 'Quantidade']} />
        <Bar dataKey="quantidade" fill={SERIE_1} radius={[0, 4, 4, 0]} maxBarSize={BARRA_MAX} {...animacao(reduzido)}>
          <LabelList dataKey="rotulo" position="right" fill="#374151" fontSize={12} />
        </Bar>
      </BarChart>
    </Area>
  )
}

export function GraficoReceita({ dados }: { dados: ReceitaDoMes[] }) {
  const reduzido = useMovimentoReduzido()
  return (
    <Area altura={260}>
      <BarChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barGap={2}>
        <CartesianGrid vertical={false} stroke={GRADE} />
        {/* padding à esquerda: em 390px o primeiro mês encostava no "R$ 0" do eixo */}
        <XAxis dataKey="rotulo" tick={EIXO} axisLine={false} tickLine={false} interval="preserveStartEnd" padding={{ left: 16, right: 8 }} />
        <YAxis tickFormatter={reaisCurtos} tick={EIXO} axisLine={false} tickLine={false} width={84} />
        <Tooltip cursor={{ fill: '#f3f4f6' }} formatter={(v, nome) => [formatCurrency(Number(v)), nome === 'recebido' ? 'Recebido' : 'Faturado']} />
        <Legend formatter={(v) => (v === 'recebido' ? 'Recebido' : 'Faturado')} wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="faturado" fill={SERIE_1} radius={[4, 4, 0, 0]} maxBarSize={BARRA_MAX} {...animacao(reduzido, 0)} />
        <Bar dataKey="recebido" fill={SERIE_2} radius={[4, 4, 0, 0]} maxBarSize={BARRA_MAX} {...animacao(reduzido, 1)} />
      </BarChart>
    </Area>
  )
}

export function GraficoProgresso({ dados }: { dados: ProgressoDaObra[] }) {
  const reduzido = useMovimentoReduzido()
  const comRotulo = dados.map((d) => ({ ...d, rotulo: `${d.progresso.toLocaleString('pt-BR')}%` }))
  return (
    <Area altura={alturaDeBarras(dados.length)}>
      <BarChart data={comRotulo} layout="vertical" margin={{ top: 4, right: 48, bottom: 4, left: 8 }}>
        <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={EIXO} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="codigo" width={110} tick={EIXO} tickFormatter={cortar(14)} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: '#f3f4f6' }} formatter={(v) => [`${Number(v).toLocaleString('pt-BR')}%`, 'Progresso']} labelFormatter={(c) => { const o = dados.find((d) => d.codigo === c); return o ? `${o.codigo} — ${o.nome}` : c }} />
        <Bar dataKey="progresso" fill={SERIE_1} background={{ fill: '#f3f4f6', radius: 4 }} radius={[0, 4, 4, 0]} maxBarSize={BARRA_MAX} {...animacao(reduzido)}>
          <LabelList dataKey="rotulo" position="right" fill="#374151" fontSize={12} />
        </Bar>
      </BarChart>
    </Area>
  )
}

export function GraficoMotivos({ dados }: { dados: MotivoDoGrafico[] }) {
  const reduzido = useMovimentoReduzido()
  return (
    <Area altura={alturaDeBarras(dados.length)}>
      <BarChart data={dados} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }} barGap={2}>
        <CartesianGrid horizontal={false} stroke={GRADE} />
        <XAxis type="number" allowDecimals={false} tick={EIXO} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="rotulo" width={190} tick={EIXO} tickFormatter={cortar(28)} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: '#f3f4f6' }} formatter={(v, nome) => [String(v), nome === 'orcamentos' ? 'Orçamentos' : 'Propostas']} />
        <Legend formatter={(v) => (v === 'orcamentos' ? 'Orçamentos' : 'Propostas')} wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="orcamentos" fill={SERIE_1} radius={[0, 4, 4, 0]} maxBarSize={BARRA_MAX / 2 + 4} {...animacao(reduzido, 0)} />
        <Bar dataKey="propostas" fill={SERIE_2} radius={[0, 4, 4, 0]} maxBarSize={BARRA_MAX / 2 + 4} {...animacao(reduzido, 1)} />
      </BarChart>
    </Area>
  )
}
