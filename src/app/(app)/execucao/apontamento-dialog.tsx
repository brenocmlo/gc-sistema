'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import Modal from '@/components/Modal'
import { formatDate } from '@/lib/format'
import {
  ETAPAS,
  ETAPA_LABELS,
  STATUS_ETAPA_CORES,
  STATUS_ETAPA_LABELS,
  formatQtd,
  limitesDaEtapa,
  qtdsDaExecucao,
  etapaAtrasada,
  hojeISO,
  statusDaEtapa,
  validarEtapa,
  validarPrevisoes,
  validarQuantidadeDaExecucao,
  validarReducaoDaExecucao,
  type ApontamentoPayload,
  type Etapa,
  type QtdsEtapas,
  type ResumoDoItem,
} from '@/lib/execucao'
import type { ExecucaoListItem } from '@/lib/types'

import { apontarExecucao, criarNovaExecucao, lerExecucao } from './actions'

type ApontamentoDialogProps = {
  execucao: ExecucaoListItem | null
  /** Execuções e soma do item desta execução, na obra inteira (7.4). */
  resumo: ResumoDoItem | null
  podeApontar: boolean
  onOpenChange: (open: boolean) => void
  /** A linha que voltou do banco, para a tabela trocar só ela. */
  onSalvo: (linha: ExecucaoListItem) => void
}

type Rascunho = {
  quantidade: string
  localizacao: string
  qtd: Record<Etapa, string>
  previsao: Record<Etapa, string>
  responsavel: Record<Etapa, string>
  observacao: Record<Etapa, string>
}

function rascunhoDe(e: ExecucaoListItem): Rascunho {
  const q = qtdsDaExecucao(e)
  const por = (campo: 'responsavel' | 'observacao' | 'previsao_fim') =>
    Object.fromEntries(ETAPAS.map((et) => [et, (e[`${et}_${campo}`] as string | null) ?? ''])) as Record<Etapa, string>
  return {
    quantidade: String(e.quantidade_total),
    localizacao: e.localizacao ?? '',
    qtd: Object.fromEntries(ETAPAS.map((et) => [et, String(q[et])])) as Record<Etapa, string>,
    previsao: por('previsao_fim'),
    responsavel: por('responsavel'),
    observacao: por('observacao'),
  }
}

/** Campo vazio vale 0; texto que não é número vira NaN, e validarEtapa acusa. */
function numero(v: string): number {
  const t = v.trim().replace(',', '.')
  return t === '' ? 0 : Number(t)
}

/**
 * O painel de apontamento (7.3): as quatro etapas em sequência, cada uma com
 * a quantidade limitada pela cascata, "Concluir etapa", responsável e
 * observação, e as datas que o trigger preenche.
 */
export default function ApontamentoDialog({
  execucao,
  resumo,
  podeApontar,
  onOpenChange,
  onSalvo,
}: ApontamentoDialogProps) {
  const [rascunho, setRascunho] = useState<Rascunho | null>(null)
  const [visto, setVisto] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const router = useRouter()
  // Congelado na abertura: o painel não muda de "atrasada" enquanto está aberto.
  const [hoje] = useState(hojeISO)
  const [nova, setNova] = useState<{ quantidade: string; localizacao: string } | null>(null)

  // Reabrir parte sempre da linha que a tabela tem.
  useEffect(() => {
    if (execucao) {
      setRascunho(rascunhoDe(execucao))
      setVisto(execucao.updated_at)
      setNova(null)
    }
  }, [execucao])

  const total = rascunho ? numero(rascunho.quantidade) : (execucao?.quantidade_total ?? 0)
  // As OUTRAS execuções do item: a soma do item menos esta, como está no banco.
  const outras = resumo && execucao ? Math.max(resumo.soma - execucao.quantidade_total, 0) : 0
  const quantidadeDoItem = resumo?.quantidadeDoItem ?? execucao?.item?.quantidade ?? 0
  const qtds: QtdsEtapas = useMemo(() => {
    const r = rascunho?.qtd
    return {
      fab: numero(r?.fab ?? '0'),
      ent: numero(r?.ent ?? '0'),
      inst: numero(r?.inst ?? '0'),
      med: numero(r?.med ?? '0'),
    }
  }, [rascunho])

  const erros = useMemo(() => {
    const out: Partial<Record<Etapa, string>> = {}
    for (const etapa of ETAPAS) {
      const r = validarEtapa(etapa, qtds[etapa], qtds, total)
      if (!r.ok) out[etapa] = r.error
    }
    return out
  }, [qtds, total])
  const erroQuantidade = useMemo(() => {
    if (!execucao || Math.round(total * 1000) === Math.round(execucao.quantidade_total * 1000)) return null
    const cabe = validarQuantidadeDaExecucao(total, quantidadeDoItem, [outras])
    if (!cabe.ok) return cabe.error
    const reducao = validarReducaoDaExecucao(total, qtds)
    return reducao.ok ? null : reducao.error
  }, [execucao, total, quantidadeDoItem, outras, qtds])
  const erroPrevisao = useMemo(() => {
    const r = rascunho?.previsao
    if (!r) return null
    const v = validarPrevisoes({
      fab: r.fab || null,
      ent: r.ent || null,
      inst: r.inst || null,
      med: r.med || null,
    })
    return v.ok ? null : v
  }, [rascunho])
  const temErro = Object.keys(erros).length > 0 || erroQuantidade !== null || erroPrevisao !== null

  if (!execucao || !rascunho) return null

  function setCampo(campo: 'qtd' | 'previsao' | 'responsavel' | 'observacao', etapa: Etapa, valor: string) {
    setRascunho((r) => (r ? { ...r, [campo]: { ...r[campo], [etapa]: valor } } : r))
  }

  const sobra = Math.max(quantidadeDoItem - outras - execucao.quantidade_total, 0)

  async function criarNova() {
    if (!execucao || !nova) return
    setSalvando(true)
    const r = await criarNovaExecucao(execucao.item_id, {
      quantidade: numero(nova.quantidade),
      localizacao: nova.localizacao,
    })
    setSalvando(false)
    if (!r.ok) {
      toast.error(`Não foi possível criar: ${r.error}`, { duration: 8000 })
      return
    }
    toast.success(`Execução ${r.sequencial} criada`)
    onOpenChange(false)
    router.refresh()
  }

  async function salvar() {
    if (!execucao || !rascunho || temErro) return
    setSalvando(true)
    const payload: ApontamentoPayload = {
      quantidade_total: total,
      localizacao: rascunho.localizacao,
      fab_previsao_fim: rascunho.previsao.fab || null,
      ent_previsao_fim: rascunho.previsao.ent || null,
      inst_previsao_fim: rascunho.previsao.inst || null,
      med_previsao_fim: rascunho.previsao.med || null,
      fab_qtd: qtds.fab,
      ent_qtd: qtds.ent,
      inst_qtd: qtds.inst,
      med_qtd: qtds.med,
      fab_responsavel: rascunho.responsavel.fab,
      ent_responsavel: rascunho.responsavel.ent,
      inst_responsavel: rascunho.responsavel.inst,
      med_responsavel: rascunho.responsavel.med,
      fab_observacao: rascunho.observacao.fab,
      ent_observacao: rascunho.observacao.ent,
      inst_observacao: rascunho.observacao.inst,
      med_observacao: rascunho.observacao.med,
    }
    const r = await apontarExecucao(execucao.id, payload, visto)
    setSalvando(false)
    if (!r.ok) {
      toast.error(`Não foi possível salvar: ${r.error}`, { duration: 8000 })
      if (r.conflito) {
        const atual = await lerExecucao(execucao.id)
        if (atual.ok) onSalvo(atual.execucao)
      }
      return
    }
    toast.success('Apontamento salvo')
    onSalvo(r.execucao)
    onOpenChange(false)
  }

  const titulo = `${execucao.item?.numero != null ? `${execucao.item.numero}. ` : ''}${
    execucao.item?.descricao ?? execucao.item?.tipo ?? 'Item'
  }${execucao.sequencial > 1 ? ` · execução ${execucao.sequencial}` : ''}`

  return (
    <Modal
      open={Boolean(execucao)}
      onOpenChange={onOpenChange}
      title={titulo}
      size="lg"
      dismissible={!salvando}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-2 items-start">
          <div>
            <label htmlFor="quantidade-execucao" className="block text-xs font-medium text-gray-600">
              Quantidade desta execução
            </label>
            <input
              id="quantidade-execucao"
              type="number"
              inputMode="decimal"
              step="0.001"
              min={qtds.fab}
              disabled={!podeApontar || salvando}
              value={rascunho.quantidade}
              onChange={(e) => setRascunho((r) => (r ? { ...r, quantidade: e.target.value } : r))}
              aria-invalid={erroQuantidade !== null}
              className={`w-full mt-1 px-2 py-1.5 border rounded-md text-sm tabular-nums ${
                erroQuantidade ? 'border-red-400' : 'border-gray-300'
              } disabled:bg-gray-50`}
            />
          </div>
          <div>
            <label htmlFor="localizacao-execucao" className="block text-xs font-medium text-gray-600">
              Localização (ex.: Torre A - 3º pavimento)
            </label>
            <input
              id="localizacao-execucao"
              type="text"
              maxLength={200}
              disabled={!podeApontar || salvando}
              value={rascunho.localizacao}
              onChange={(e) => setRascunho((r) => (r ? { ...r, localizacao: e.target.value } : r))}
              className="w-full mt-1 px-2 py-1.5 border border-gray-300 rounded-md text-sm disabled:bg-gray-50"
            />
          </div>
        </div>
        {erroQuantidade && (
          <p id="erro-quantidade" role="alert" className="text-xs text-red-700">
            {erroQuantidade}
          </p>
        )}
        <p className="text-sm text-gray-600" data-testid="resumo-item">
          O item tem <strong>{formatQtd(quantidadeDoItem)}</strong> {execucao.item?.unidade ?? ''}
          {resumo && resumo.execucoes > 1
            ? ` em ${resumo.execucoes} execuções; as outras somam ${formatQtd(outras)}.`
            : '.'}{' '}
          Cada etapa vai até o que a anterior já tem.
        </p>

        <ol className="space-y-3">
          {ETAPAS.map((etapa, i) => {
            const { min, max } = limitesDaEtapa(etapa, qtds, total)
            const status = statusDaEtapa(qtds[etapa], total)
            const erro = erros[etapa]
            const inicio = execucao[`${etapa}_data_inicio`] as string | null
            const atualizacao = execucao[`${etapa}_data_atualizacao`] as string | null
            const fim = execucao[`${etapa}_data_fim`] as string | null
            // Atraso do que está GRAVADO (a previsão do banco), como na listagem.
            const atrasada = etapaAtrasada(execucao, etapa, hoje)
            return (
              <li
                key={etapa}
                className="rounded-lg border border-gray-200 p-3 space-y-2"
                data-etapa={etapa}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="text-sm font-semibold text-gray-900">
                    {i + 1}. {ETAPA_LABELS[etapa]}
                  </h3>
                  <span className="flex items-center gap-1">
                    {atrasada && (
                      <span className="inline-flex px-1.5 py-0.5 rounded text-[11px] font-medium border bg-red-100 text-red-700 border-red-200">
                        Atrasada
                      </span>
                    )}
                    <span
                      className={`inline-flex px-1.5 py-0.5 rounded text-[11px] font-medium border ${STATUS_ETAPA_CORES[status].selo}`}
                    >
                      {STATUS_ETAPA_LABELS[status]}
                    </span>
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-[160px_150px_1fr_1fr] gap-2 items-start">
                  <div>
                    <label htmlFor={`qtd-${etapa}`} className="block text-xs font-medium text-gray-600">
                      Quantidade (máx. {formatQtd(max)})
                    </label>
                    <div className="flex gap-1 mt-1">
                      <input
                        id={`qtd-${etapa}`}
                        type="number"
                        inputMode="decimal"
                        step="0.001"
                        min={min}
                        max={max}
                        disabled={!podeApontar || salvando}
                        value={rascunho.qtd[etapa]}
                        onChange={(e) => setCampo('qtd', etapa, e.target.value)}
                        aria-invalid={Boolean(erro)}
                        aria-describedby={erro ? `erro-${etapa}` : undefined}
                        className={`w-full px-2 py-1.5 border rounded-md text-sm tabular-nums ${
                          erro ? 'border-red-400' : 'border-gray-300'
                        } disabled:bg-gray-50`}
                      />
                      {podeApontar && (
                        <button
                          type="button"
                          disabled={salvando || milesimosIguais(qtds[etapa], max)}
                          onClick={() => setCampo('qtd', etapa, String(max))}
                          className="px-2 py-1.5 rounded-md border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50 whitespace-nowrap disabled:opacity-40"
                          title={`Preenche com o máximo (${formatQtd(max)})`}
                        >
                          Concluir etapa
                        </button>
                      )}
                    </div>
                  </div>
                  <div>
                    <label htmlFor={`prev-${etapa}`} className="block text-xs font-medium text-gray-600">
                      Previsão de fim
                    </label>
                    <input
                      id={`prev-${etapa}`}
                      type="date"
                      disabled={!podeApontar || salvando}
                      value={rascunho.previsao[etapa]}
                      onChange={(e) => setCampo('previsao', etapa, e.target.value)}
                      aria-invalid={erroPrevisao?.etapa === etapa}
                      className={`w-full mt-1 px-2 py-1.5 border rounded-md text-sm ${
                        erroPrevisao?.etapa === etapa ? 'border-red-400' : 'border-gray-300'
                      } disabled:bg-gray-50`}
                    />
                  </div>
                  <div>
                    <label htmlFor={`resp-${etapa}`} className="block text-xs font-medium text-gray-600">
                      Responsável
                    </label>
                    <input
                      id={`resp-${etapa}`}
                      type="text"
                      maxLength={200}
                      disabled={!podeApontar || salvando}
                      value={rascunho.responsavel[etapa]}
                      onChange={(e) => setCampo('responsavel', etapa, e.target.value)}
                      className="w-full mt-1 px-2 py-1.5 border border-gray-300 rounded-md text-sm disabled:bg-gray-50"
                    />
                  </div>
                  <div>
                    <label htmlFor={`obs-${etapa}`} className="block text-xs font-medium text-gray-600">
                      Observação
                    </label>
                    <input
                      id={`obs-${etapa}`}
                      type="text"
                      maxLength={1000}
                      disabled={!podeApontar || salvando}
                      value={rascunho.observacao[etapa]}
                      onChange={(e) => setCampo('observacao', etapa, e.target.value)}
                      className="w-full mt-1 px-2 py-1.5 border border-gray-300 rounded-md text-sm disabled:bg-gray-50"
                    />
                  </div>
                </div>

                {erro && (
                  <p id={`erro-${etapa}`} role="alert" className="text-xs text-red-700">
                    {erro}
                  </p>
                )}
                {erroPrevisao?.etapa === etapa && (
                  <p id={`erro-prev-${etapa}`} role="alert" className="text-xs text-red-700">
                    {erroPrevisao.error}
                  </p>
                )}

                <p className="text-[11px] text-gray-500">
                  Início {inicio ? formatDate(inicio) : '—'} · Última atualização{' '}
                  {atualizacao ? formatDate(atualizacao) : '—'} · Fim {fim ? formatDate(fim) : '—'}
                </p>
              </li>
            )
          })}
        </ol>

        <p className="text-xs text-gray-500">
          As datas são preenchidas pelo banco quando a quantidade muda: início na primeira vez
          acima de zero, fim quando a etapa chega ao total.
        </p>

        {podeApontar && (
          <div className="rounded-lg border border-dashed border-gray-300 p-3 space-y-2">
            {nova === null ? (
              <button
                type="button"
                disabled={salvando}
                onClick={() => setNova({ quantidade: sobra > 0 ? String(sobra) : '', localizacao: '' })}
                className="text-sm font-medium text-blue-700 hover:underline disabled:opacity-50"
              >
                Nova execução deste item
              </button>
            ) : (
              <>
                <p className="text-xs text-gray-600">
                  {sobra > 0
                    ? `Sobram ${formatQtd(sobra)} do item fora das execuções.`
                    : 'O item já está todo distribuído. Reduza a quantidade desta execução acima, salve, e crie a nova com o que sobrar.'}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr_auto] gap-2 items-end">
                  <div>
                    <label htmlFor="nova-quantidade" className="block text-xs font-medium text-gray-600">
                      Quantidade
                    </label>
                    <input
                      id="nova-quantidade"
                      type="number"
                      inputMode="decimal"
                      step="0.001"
                      min={0}
                      max={sobra}
                      disabled={salvando}
                      value={nova.quantidade}
                      onChange={(e) => setNova((n) => (n ? { ...n, quantidade: e.target.value } : n))}
                      className="w-full mt-1 px-2 py-1.5 border border-gray-300 rounded-md text-sm tabular-nums"
                    />
                  </div>
                  <div>
                    <label htmlFor="nova-localizacao" className="block text-xs font-medium text-gray-600">
                      Localização
                    </label>
                    <input
                      id="nova-localizacao"
                      type="text"
                      maxLength={200}
                      disabled={salvando}
                      value={nova.localizacao}
                      onChange={(e) => setNova((n) => (n ? { ...n, localizacao: e.target.value } : n))}
                      className="w-full mt-1 px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={criarNova}
                    disabled={salvando || sobra <= 0}
                    className="px-3 py-1.5 rounded-md bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:bg-gray-400"
                  >
                    Criar execução
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200 -mx-6 px-6 -mb-4 pb-4 bg-gray-50 rounded-b-lg">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={salvando}
            className="px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {podeApontar ? 'Cancelar' : 'Fechar'}
          </button>
          {podeApontar && (
            <button
              type="button"
              onClick={salvar}
              disabled={salvando || temErro}
              className="px-4 py-2 rounded-md bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {salvando ? 'Salvando...' : 'Salvar apontamento'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

function milesimosIguais(a: number, b: number): boolean {
  return Math.round(a * 1000) === Math.round(b * 1000)
}
