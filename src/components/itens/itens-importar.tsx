'use client'

import { AlertTriangle, Check, Download, Loader2, Upload } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import Modal from '@/components/Modal'
import { formatCurrency } from '@/lib/format'
import { valorTotalDoItem, type PaiItem } from '@/lib/itens'
import {
  itemFormParaPayload,
  resumoDaPlanilha,
  validarPlanilha,
  type ChaveImportacao,
  type LinhaValidada,
} from '@/lib/itens-form'
import { lerPlanilhaItens } from '@/lib/itens-planilha'
import type { Item } from '@/lib/types'

import { importarItens } from './itens-actions'

type ItensImportarProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Proposta ou contrato dono do item (bloco 6.4). */
  pai: PaiItem
  itens: Item[]
  onImportado: () => void
}

/**
 * Importação em massa de itens por planilha (bloco 5.4).
 *
 * O enunciado é claro sobre o motivo: a empresa vem de Excel e não vai
 * redigitar centenas de itens. Três etapas, nesta ordem:
 *
 *   1. baixar o template (`/api/template/itens`);
 *   2. subir a planilha preenchida, que é parseada **no navegador** com
 *      exceljs e validada linha a linha pelo MESMO schema do formulário;
 *   3. conferir o preview — válidas em verde, com erro em vermelho e o motivo
 *      — corrigir ou ignorar, e só então confirmar.
 *
 * Parse no cliente e não no servidor de propósito: o arquivo não precisa
 * subir para a pessoa descobrir que a coluna Quantidade está vazia, e
 * planilha errada não gasta requisição nem chega perto do banco. O que sobe é
 * só a lista de linhas já validadas.
 */
export default function ItensImportar({
  open,
  onOpenChange,
  pai,
  itens,
  onImportado,
}: ItensImportarProps) {
  const [lendo, setLendo] = useState(false)
  const [gravando, setGravando] = useState(false)
  const [linhas, setLinhas] = useState<LinhaValidada[] | null>(null)
  const [ignoradas, setIgnoradas] = useState<Set<number>>(new Set())
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null)

  const numerosExistentes = itens
    .map((i) => i.numero)
    .filter((n): n is number => n !== null)

  function limpar() {
    setLinhas(null)
    setIgnoradas(new Set())
    setNomeArquivo(null)
  }

  async function aoEscolherArquivo(file: File) {
    setLendo(true)
    limpar()
    try {
      // Parse em src/lib/itens-planilha.ts: função pura, coberta por
      // node --test com .xlsx gerados de verdade.
      const lido = await lerPlanilhaItens(await file.arrayBuffer())
      if (!lido.ok) {
        toast.error(lido.erro, { duration: 10000 })
        return
      }
      const brutas = lido.linhas

      setLinhas(validarPlanilha(brutas, numerosExistentes, lido.numerosDasLinhas))
      setNomeArquivo(file.name)
    } catch (e) {
      toast.error(
        `Não consegui ler a planilha: ${e instanceof Error ? e.message : 'arquivo inválido'}`,
        { duration: 8000 },
      )
    } finally {
      setLendo(false)
    }
  }

  const resumo = linhas ? resumoDaPlanilha(linhas) : null

  // O que vai gravar: as válidas que não foram marcadas para ignorar.
  const paraGravar = (linhas ?? []).filter(
    (l) => l.ok && !ignoradas.has(l.linha),
  )

  async function confirmar() {
    if (paraGravar.length === 0) {
      toast.error('Nenhuma linha selecionada para importar')
      return
    }

    setGravando(true)
    const payloads = paraGravar.map((l) =>
      itemFormParaPayload((l as Extract<LinhaValidada, { ok: true }>).valores),
    )
    const naoImportadas = (linhas ?? []).length - paraGravar.length

    const r = await importarItens(pai, payloads, naoImportadas)
    setGravando(false)

    if (!r.ok) {
      toast.error(r.error, { duration: 10000 })
      return
    }

    toast.success(
      `${r.importados} ${r.importados === 1 ? 'item importado' : 'itens importados'}` +
        (r.ignorados > 0 ? `, ${r.ignorados} ignorados` : ''),
      { duration: 8000 },
    )
    limpar()
    onOpenChange(false)
    onImportado()
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) limpar()
        onOpenChange(o)
      }}
      title="Importar itens de planilha"
      size="lg"
      dismissible={!gravando && !lendo}
    >
      <div className="space-y-5">
        {/* Etapa 1 */}
        <div className="rounded-md border border-gray-200 p-4">
          <p className="text-sm font-medium text-gray-900">
            1. Baixe o template
          </p>
          <p className="mt-1 text-sm text-gray-600">
            As colunas têm de ser exatamente as do template. Área m² e Valor
            total não entram: o sistema calcula.
          </p>
          <a
            href="/api/template/itens"
            className="mt-3 inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Download className="h-4 w-4" />
            Baixar itens-template.xlsx
          </a>
        </div>

        {/* Etapa 2 */}
        <div className="rounded-md border border-gray-200 p-4">
          <p className="text-sm font-medium text-gray-900">
            2. Suba a planilha preenchida
          </p>
          <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            {lendo ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {nomeArquivo ?? 'Escolher arquivo .xlsx'}
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              aria-label="Planilha de itens"
              disabled={lendo || gravando}
              onChange={(e) => {
                const f = e.target.files?.[0]
                // Zera o value para o mesmo arquivo poder ser escolhido de novo
                // depois de uma correção no Excel.
                e.target.value = ''
                if (f) void aoEscolherArquivo(f)
              }}
            />
          </label>
        </div>

        {/* Etapa 3 — preview */}
        {resumo && linhas && (
          <div className="rounded-md border border-gray-200">
            <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3 text-sm">
              <span className="font-medium text-gray-900">
                3. Confira antes de gravar
              </span>
              <span className="text-gray-600">{resumo.total} linhas</span>
              <span className="inline-flex items-center gap-1 text-green-700">
                <Check className="h-4 w-4" />
                {resumo.validas} válidas
              </span>
              {resumo.comErro > 0 && (
                <span className="inline-flex items-center gap-1 text-red-700">
                  <AlertTriangle className="h-4 w-4" />
                  {resumo.comErro} com erro
                </span>
              )}
            </div>

            <div className="max-h-72 overflow-y-auto">
              <table
                aria-label="Preview da importação"
                className="w-full text-sm"
              >
                <thead className="sticky top-0 bg-white text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Linha</th>
                    <th className="px-3 py-2 text-left">Item</th>
                    <th className="px-3 py-2 text-right">Qtd</th>
                    <th className="px-3 py-2 text-right">Valor total</th>
                    <th className="px-3 py-2 text-left">Situação</th>
                    <th className="px-3 py-2 text-left">Importar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {linhas.map((l) => (
                    <LinhaPreview
                      key={l.linha}
                      linha={l}
                      ignorada={ignoradas.has(l.linha)}
                      onAlternar={() =>
                        setIgnoradas((s) => {
                          const n = new Set(s)
                          if (n.has(l.linha)) n.delete(l.linha)
                          else n.add(l.linha)
                          return n
                        })
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {resumo.comErro > 0 && (
              <p className="border-t border-gray-200 px-4 py-3 text-sm text-gray-600">
                Linhas com erro não são importadas. Corrija no Excel e suba o
                arquivo de novo, ou siga só com as válidas.
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-gray-200 pt-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={gravando}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={gravando || paraGravar.length === 0}
            className="inline-flex items-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {gravando && <Loader2 className="h-4 w-4 animate-spin" />}
            {gravando
              ? 'Importando...'
              : `Importar ${paraGravar.length} ${paraGravar.length === 1 ? 'item' : 'itens'}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function LinhaPreview({
  linha,
  ignorada,
  onAlternar,
}: {
  linha: LinhaValidada
  ignorada: boolean
  onAlternar: () => void
}) {
  const rotulo = (chave: ChaveImportacao) => String(linha.bruto[chave] ?? '')

  const descricao =
    [rotulo('numero'), rotulo('tipo'), rotulo('descricao')]
      .filter((s) => s !== '')
      .join(' · ') || '(linha em branco)'

  if (!linha.ok) {
    return (
      <tr className="bg-red-50">
        <td className="px-3 py-2 tabular-nums text-red-900">{linha.linha}</td>
        <td className="px-3 py-2 text-red-900">{descricao}</td>
        <td className="px-3 py-2 text-right text-red-900">
          {rotulo('quantidade') || '—'}
        </td>
        <td className="px-3 py-2 text-right text-red-900">—</td>
        <td className="px-3 py-2 text-red-800" colSpan={2}>
          {linha.erros.join(' · ')}
        </td>
      </tr>
    )
  }

  const total = valorTotalDoItem(
    linha.valores.valor_unit,
    linha.valores.quantidade,
  )

  return (
    <tr className={ignorada ? 'bg-gray-50 text-gray-400' : 'bg-green-50'}>
      <td className="px-3 py-2 tabular-nums">{linha.linha}</td>
      <td className="px-3 py-2">{descricao}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {linha.valores.quantidade}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {total === null ? '—' : formatCurrency(total)}
      </td>
      <td className="px-3 py-2">
        {ignorada ? (
          <span className="text-gray-500">Ignorada</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-green-700">
            <Check className="h-4 w-4" />
            Válida
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={!ignorada}
            onChange={onAlternar}
            aria-label={`Importar a linha ${linha.linha}`}
            className="h-4 w-4 rounded border-gray-300"
          />
          <span className="text-xs text-gray-600">
            {ignorada ? 'incluir' : 'incluída'}
          </span>
        </label>
      </td>
    </tr>
  )
}
