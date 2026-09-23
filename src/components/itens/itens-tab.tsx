'use client'

import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  Loader2,
  Pencil,
  Percent,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import ConfirmDialog from '@/components/ConfirmDialog'
import Modal from '@/components/Modal'
import { formatCurrency } from '@/lib/format'
import {
  UNIDADES,
  UNIDADE_LABELS,
  AJUSTE_MAXIMO,
  AJUSTE_MINIMO,
  areaDoItem,
  divergenciaDeValor,
  formatArea,
  formatDimensao,
  formatUnidade,
  formatUnidadeSufixo,
  proximoNumeroItem,
  previaAjuste,
  totaisDosItens,
  validarPercentual,
  valorTotalDoItem,
  vizinhoParaMover,
  TEXTOS_PAI,
  type PaiItem,
} from '@/lib/itens'
import {
  itemFormVazio,
  itemParaFormValues,
  type ItemFormValues,
} from '@/lib/itens-form'
import type { Item, Perfil, Unidade } from '@/lib/types'

import ItemForm from './item-form'
import ItensImportar from './itens-importar'

import {
  ajustarValorEmLote,
  createItem,
  deleteItem,
  duplicarItem,
  excluirItensEmLote,
  moverItem,
  sincronizarValorComItens,
  updateItem,
  type ItemFormInput,
} from './itens-actions'

type ItensTabProps = {
  /** Dono dos itens: proposta (sprint 5) ou contrato (bloco 6.4). */
  pai: PaiItem
  itens: Item[]
  /** `valor_total` do pai, para o aviso de divergência (bloco 5.6). */
  valorTotalPai: number | null
  /** Desconto do pai: soma abaixo dele é divergência esperada. */
  descontoPai: number | null
  perfil: Perfil
  /**
   * Proposta fora de rascunho, ou contrato que não está ativo, vira
   * somente-leitura — a mesma regra que as actions conferem no servidor.
   */
  editavel: boolean
}

/** Estado de salvamento de uma linha, para o indicador salvo/salvando. */
type EstadoLinha = 'parado' | 'salvando' | 'salvo' | 'erro'

export default function ItensTab({
  pai,
  itens,
  valorTotalPai,
  descontoPai,
  perfil,
  editavel,
}: ItensTabProps) {
  const router = useRouter()
  const t = TEXTOS_PAI[pai.tipo]
  /** "da proposta" / "do contrato" */
  const doPai = `${t.o === 'a' ? 'da' : 'do'} ${t.nome}`
  const [excluindo, setExcluindo] = useState<Item | null>(null)
  /** null = fechado; { item: null } = criar; { item } = editar. */
  const [formulario, setFormulario] = useState<{
    item: Item | null
    defaults: ItemFormValues
  } | null>(null)
  const [estados, setEstados] = useState<Record<string, EstadoLinha>>({})
  const [adicionando, setAdicionando] = useState(false)
  const [importando, setImportando] = useState(false)

  // ---- Bloco 5.7: seleção, lote, duplicar e reordenar ----
  const [selecionadosBrutos, setSelecionados] = useState<Set<string>>(new Set())
  // Item que saiu (excluído, ou a tela recarregou) sai da seleção sozinho.
  const selecionados = new Set(
    Array.from(selecionadosBrutos).filter((id) => itens.some((i) => i.id === id)),
  )
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [excluindoLote, setExcluindoLote] = useState(false)
  const [ajustando, setAjustando] = useState(false)
  const [percentual, setPercentual] = useState('')
  const [aplicandoAjuste, setAplicandoAjuste] = useState(false)

  function alternarSelecao(id: string) {
    setSelecionados((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function alternarTodos() {
    setSelecionados(
      selecionados.size === itens.length ? new Set() : new Set(itens.map((i) => i.id)),
    )
  }

  async function duplicar(item: Item) {
    setOcupado(item.id)
    const r = await duplicarItem(pai, item.id)
    setOcupado(null)
    if (!r.ok) {
      toast.error(r.error)
      return
    }
    toast.success(`Item duplicado como nº ${r.item.numero}`)
    router.refresh()
  }

  async function mover(item: Item, direcao: 'subir' | 'descer') {
    setOcupado(item.id)
    const r = await moverItem(pai, item.id, direcao)
    setOcupado(null)
    if (!r.ok) {
      toast.error(r.error)
      return
    }
    router.refresh()
  }

  async function confirmarExclusaoLote() {
    const ids = Array.from(selecionados)
    const r = await excluirItensEmLote(pai, ids)
    if (!r.ok) {
      toast.error(r.error, { duration: 8000 })
      return
    }
    toast.success(`${r.afetados} ${r.afetados === 1 ? 'item excluído' : 'itens excluídos'}`)
    setExcluindoLote(false)
    setSelecionados(new Set())
    router.refresh()
  }

  const percentualNumero = Number(percentual.replace(',', '.'))
  const erroPercentual = percentual === '' ? null : validarPercentual(percentual)
  const itensSelecionados = itens.filter((i) => selecionados.has(i.id))
  const previa =
    percentual !== '' && !erroPercentual
      ? previaAjuste(itensSelecionados, percentualNumero)
      : null

  async function aplicarAjuste() {
    if (validarPercentual(percentual)) return
    setAplicandoAjuste(true)
    const r = await ajustarValorEmLote(pai, Array.from(selecionados), percentualNumero)
    setAplicandoAjuste(false)
    if (!r.ok) {
      toast.error(r.error, { duration: 8000 })
      return
    }
    toast.success(
      `Valor ajustado em ${percentualNumero > 0 ? '+' : ''}${percentualNumero}% em ${r.afetados} ${r.afetados === 1 ? 'item' : 'itens'}`,
    )
    setAjustando(false)
    setPercentual('')
    setSelecionados(new Set())
    router.refresh()
  }

  /**
   * Último `updated_at` conhecido de cada linha, para o lock otimista.
   *
   * Não dá pra usar `item.updated_at` direto: `router.refresh()` é assíncrono,
   * e quem sai de um campo e entra no outro (Tab) dispara o segundo save antes
   * de a tela recarregar. O segundo mandaria o `updated_at` velho e levaria um
   * conflito FALSO. Aqui a versão é atualizada com o que a própria action
   * devolve, que já é o valor novo.
   *
   * `useRef` e não `useState` de propósito: precisa estar legível na mesma
   * volta do event loop, sem esperar re-render.
   */
  const versoes = useRef<Record<string, string>>({})

  /** Saves em voo por linha, para encadear em vez de corrida. */
  const emVoo = useRef<Record<string, Promise<void>>>({})

  const podeEditar =
    editavel && (perfil === 'admin' || perfil === 'comercial')
  // Excluir é só admin: é o que a policy "Itens: admin exclui" permite. Até o
  // bloco 5.5 a lixeira aparecia para comercial, o RLS negava em silêncio e a
  // tela dizia "Item excluído" com o item ainda lá.
  const podeExcluir = editavel && perfil === 'admin'

  function marcar(id: string, estado: EstadoLinha) {
    setEstados((s) => ({ ...s, [id]: estado }))
    if (estado === 'salvo') {
      // O check some sozinho: indicador permanente vira ruído visual.
      setTimeout(() => {
        setEstados((s) => (s[id] === 'salvo' ? { ...s, [id]: 'parado' } : s))
      }, 2000)
    }
  }

  function salvarLinha(item: Item, campos: ItemFormInput) {
    // Encadeia no save anterior desta linha: dois Tab rápidos não viram
    // corrida, viram fila.
    const anterior = emVoo.current[item.id] ?? Promise.resolve()
    const atual = anterior.then(() => gravar(item, campos))
    emVoo.current[item.id] = atual.catch(() => {})
    return atual
  }

  async function gravar(item: Item, campos: ItemFormInput) {
    marcar(item.id, 'salvando')

    // A versão conhecida vem do ref (atualizada pela resposta anterior) e cai
    // no que a tela renderizou na primeira vez.
    const visto = versoes.current[item.id] ?? item.updated_at
    const r = await updateItem(pai, item.id, campos, visto)

    if (!r.ok) {
      marcar(item.id, 'erro')
      // Conflito de concorrência fica mais tempo na tela: a pessoa precisa
      // ler o que aconteceu antes de digitar de novo.
      toast.error(r.error, { duration: 8000 })
      // A versão local não vale mais; a próxima tentativa relê da tela.
      delete versoes.current[item.id]
      // Volta ao que o banco tem: manter o valor recusado na tela faria a
      // pessoa achar que salvou.
      router.refresh()
      return
    }

    if (r.item.updated_at) versoes.current[item.id] = r.item.updated_at
    marcar(item.id, 'salvo')
    router.refresh()
  }

  async function adicionar() {
    setAdicionando(true)
    const r = await createItem(pai, {
      numero: proximoNumeroItem(itens),
      tipo: null,
      descricao: null,
      linha: null,
      acabamento: null,
      largura: null,
      altura: null,
      quantidade: 1,
      unidade: 'QTD',
      valor_unit: null,
    })
    setAdicionando(false)

    if (!r.ok) {
      toast.error(r.error)
      return
    }
    router.refresh()
  }

  function abrirFormularioNovo() {
    setFormulario({
      item: null,
      defaults: itemFormVazio(proximoNumeroItem(itens)),
    })
  }

  function abrirFormularioDe(item: Item) {
    setFormulario({ item, defaults: itemParaFormValues(item) })
  }

  /**
   * Números em uso pelos OUTROS itens. O do item em edição sai da lista,
   * senão o formulário acusaria conflito do item consigo mesmo.
   */
  function numerosEmUsoPara(item: Item | null): number[] {
    return itens
      .filter((i) => i.id !== item?.id)
      .map((i) => i.numero)
      .filter((n): n is number => n !== null)
  }

  async function confirmarExclusao() {
    if (!excluindo) return
    const r = await deleteItem(pai, excluindo.id)
    if (!r.ok) {
      toast.error(r.error)
      return
    }
    toast.success('Item excluído')
    setExcluindo(null)
    router.refresh()
  }

  // Totais do rodapé. Vêm de `totaisDosItens`, que tem teste unitário — antes
  // isto era um `reduce` por coluna aqui dentro, e a soma passava a existir em
  // dois lugares, um testado e outro não.
  const totais = totaisDosItens(itens)
  const divergencia = divergenciaDeValor(valorTotalPai, itens, descontoPai)
  const [sincronizando, setSincronizando] = useState(false)

  async function sincronizar() {
    setSincronizando(true)
    const r = await sincronizarValorComItens(pai)
    setSincronizando(false)
    if (!r.ok) {
      toast.error(r.error, { duration: 8000 })
      return
    }
    toast.success(`Valor total ${doPai} ajustado para a soma dos itens`)
    router.refresh()
  }

  if (itens.length === 0 && !podeEditar) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-500">
        {/* Uma string só: texto literal ao lado de {expressão} ganha um <!-- -->
            no SSR, e a frase deixaria de existir inteira no HTML. */}
        {pai.tipo === 'proposta' ? 'Esta proposta não tem itens.' : 'Este contrato não tem itens.'}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {divergencia.diverge && (
        <div
          role="alert"
          data-testid="aviso-divergencia"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          {divergencia.somaAbaixoDoDesconto ? (
            <p>
              A soma dos itens ({formatCurrency(divergencia.soma)}) ainda não
              alcança o desconto {doPai} ({formatCurrency(descontoPai)}).
              Enquanto isso, vale o valor digitado (
              {formatCurrency(valorTotalPai)}); quando a soma passar do
              desconto, o valor total passa a acompanhá-la sozinho.
            </p>
          ) : (
            <p>
              O valor total {doPai} ({formatCurrency(valorTotalPai)}) é
              diferente da soma dos itens ({formatCurrency(divergencia.soma)}):{' '}
              {divergencia.diferenca > 0 ? 'sobram' : 'faltam'}{' '}
              {formatCurrency(Math.abs(divergencia.diferenca))}. Isto acontece
              com {t.nome} anterior ao recálculo automático ou alterad{t.o} fora
              do sistema.
            </p>
          )}
          {podeEditar && !divergencia.somaAbaixoDoDesconto && (
            <button
              type="button"
              onClick={sincronizar}
              disabled={sincronizando}
              className="shrink-0 rounded-md border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            >
              {sincronizando ? 'Ajustando...' : 'Usar a soma dos itens'}
            </button>
          )}
        </div>
      )}

      {podeEditar && selecionados.size > 0 && (
        <div
          role="toolbar"
          aria-label="Ações nos itens selecionados"
          className="flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900"
        >
          <span className="font-medium">
            {selecionados.size} {selecionados.size === 1 ? 'item selecionado' : 'itens selecionados'}
          </span>
          <button
            type="button"
            onClick={() => setAjustando(true)}
            className="inline-flex items-center gap-1 rounded-md border border-blue-300 bg-white px-3 py-1.5 font-medium hover:bg-blue-100"
          >
            <Percent className="h-4 w-4" />
            Ajustar valor
          </button>
          {podeExcluir && (
            <button
              type="button"
              onClick={() => setExcluindoLote(true)}
              className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-3 py-1.5 font-medium text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
              Excluir selecionados
            </button>
          )}
          <button
            type="button"
            onClick={() => setSelecionados(new Set())}
            className="ml-auto text-blue-700 underline-offset-2 hover:underline"
          >
            Limpar seleção
          </button>
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table
          aria-label={`Itens ${doPai}`}
          className="w-full min-w-[1108px] table-fixed text-sm"
        >
          {/*
            Largura explícita por coluna. Com `table-layout: auto` a sobra ia
            toda pra Descrição e comprimia Tipo, Linha e Valor unit., que na
            conferência visual de 2026-09-21 apareciam cortados no meio da
            palavra ("Jane", "Supre", "890,5"). `table-fixed` + colgroup dá a
            cada coluna o que ela precisa; quem não couber na tela rola no
            container, que é o contrato medido em 390px.
          */}
          {/*
            Soma = 1108px (32+68+116+112+84+88+56+52+52+60+80+96+112+100) desde o 5.7, que acrescentou seleção, sobe/desce e duplicar sem alargar a tabela. Calibrada para caber no desktop de 1440 (que sobra
            ~1136 depois da sidebar de 240 e do padding de 64). A primeira
            calibragem usou 1300 e empurrou "Valor total" para fora da tela —
            a coluna que mais importa exigindo rolagem. Descrição é a que cede
            espaço, porque é texto livre e tem `title` com o valor inteiro.
          */}
          <colgroup>
            <col className="w-[32px]" />
            <col className="w-[68px]" />
            <col className="w-[116px]" />
            <col className="w-[112px]" />
            <col className="w-[84px]" />
            <col className="w-[88px]" />
            <col className="w-[56px]" />
            <col className="w-[52px]" />
            <col className="w-[52px]" />
            <col className="w-[60px]" />
            <col className="w-[80px]" />
            <col className="w-[96px]" />
            <col className="w-[112px]" />
            <col className="w-[100px]" />
          </colgroup>
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <Th>
                {podeEditar && itens.length > 0 && (
                  <input
                    type="checkbox"
                    aria-label="Selecionar todos os itens"
                    checked={selecionados.size === itens.length}
                    ref={(el) => {
                      if (el) el.indeterminate = selecionados.size > 0 && selecionados.size < itens.length
                    }}
                    onChange={alternarTodos}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                )}
              </Th>
              <Th>Nº</Th>
              <Th>Tipo</Th>
              <Th>Descrição</Th>
              <Th>Linha</Th>
              <Th>Acabam.</Th>
              <Th className="text-right">Larg.</Th>
              <Th className="text-right">Alt.</Th>
              <Th className="text-right">Qtd</Th>
              <Th>Un.</Th>
              <Th className="text-right">Área m²</Th>
              <Th className="text-right">Valor unit.</Th>
              <Th className="text-right">Valor total</Th>
              <Th />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {itens.length === 0 ? (
              <tr>
                <td
                  colSpan={14}
                  className="px-3 py-6 text-center text-sm text-gray-500"
                >
                  Nenhum item ainda. Use &ldquo;Adicionar item&rdquo; abaixo.
                </td>
              </tr>
            ) : (
              itens.map((item) => (
                <LinhaItem
                  key={item.id}
                  item={item}
                  editavel={podeEditar}
                  podeExcluir={podeExcluir}
                  selecionado={selecionados.has(item.id)}
                  onSelecionar={() => alternarSelecao(item.id)}
                  podeSubir={vizinhoParaMover(itens, item.id, 'subir') !== null}
                  podeDescer={vizinhoParaMover(itens, item.id, 'descer') !== null}
                  ocupado={ocupado === item.id}
                  onMover={(d) => mover(item, d)}
                  onDuplicar={() => duplicar(item)}
                  estado={estados[item.id] ?? 'parado'}
                  onSalvar={(campos) => salvarLinha(item, campos)}
                  onAbrirFormulario={() => abrirFormularioDe(item)}
                  onExcluir={() => setExcluindo(item)}
                />
              ))
            )}
          </tbody>
          {itens.length > 0 && (
            <tfoot className="bg-gray-50 font-medium text-gray-900">
              <tr>
                <td className="px-3 py-2" colSpan={8}>
                  {totais.contagem} {totais.contagem === 1 ? 'item' : 'itens'}
                </td>
                <td className="px-3 py-2 text-right">{totais.quantidade}</td>
                <td className="px-3 py-2" />
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {formatArea(totais.area)}
                </td>
                <td className="px-3 py-2" />
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {formatCurrency(totais.valor)}
                </td>
                <td className="px-3 py-2" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {podeEditar && (
        <button
          type="button"
          onClick={adicionar}
          disabled={adicionando}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {adicionando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Adicionar item
        </button>
      )}

      {podeEditar && (
        <button
          type="button"
          onClick={abrirFormularioNovo}
          className="ml-2 inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <Pencil className="h-4 w-4" />
          Adicionar com todos os campos
        </button>
      )}

      {podeEditar && (
        <button
          type="button"
          onClick={() => setImportando(true)}
          className="ml-2 inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <Upload className="h-4 w-4" />
          Importar planilha
        </button>
      )}

      {!editavel && itens.length > 0 && (
        <p className="text-sm text-gray-500">
          {pai.tipo === 'proposta'
            ? 'A proposta saiu de rascunho: os itens ficam somente leitura.'
            : 'O contrato não está ativo: os itens ficam somente leitura.'}
        </p>
      )}

      <ConfirmDialog
        open={excluindo !== null}
        onOpenChange={(open) => !open && setExcluindo(null)}
        title="Excluir item?"
        description={
          excluindo
            ? `O item ${excluindo.numero ?? ''} ${
                excluindo.descricao ? `"${excluindo.descricao}"` : ''
              } será removido permanentemente ${doPai}.`.replace(/\s+/g, ' ')
            : ''
        }
        variant="danger"
        confirmLabel="Excluir"
        onConfirm={confirmarExclusao}
      />


      <ConfirmDialog
        open={excluindoLote}
        onOpenChange={setExcluindoLote}
        title={`Excluir ${selecionados.size} ${selecionados.size === 1 ? 'item' : 'itens'}?`}
        description={`Os itens selecionados e as fotos deles serão removidos permanentemente ${doPai}.`}
        variant="danger"
        confirmLabel="Sim, excluir"
        onConfirm={confirmarExclusaoLote}
      />

      <Modal
        open={ajustando}
        onOpenChange={(o) => {
          if (!o) setPercentual('')
          setAjustando(o)
        }}
        title={`Ajustar o valor de ${selecionados.size} ${selecionados.size === 1 ? 'item' : 'itens'}`}
        dismissible={!aplicandoAjuste}
      >
        <div className="space-y-4">
          <label className="block text-sm font-medium text-gray-900" htmlFor="ajuste_percentual">
            Percentual sobre o valor unitário
          </label>
          <div className="flex items-center gap-2">
            <input
              id="ajuste_percentual"
              type="text"
              inputMode="decimal"
              value={percentual}
              onChange={(e) => setPercentual(e.target.value)}
              placeholder="ex.: 5 ou -10"
              className="w-32 rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <span className="text-sm text-gray-600">%</span>
          </div>
          <p className="text-xs text-gray-500">
            Entre {AJUSTE_MINIMO}% (exclusivo) e +{AJUSTE_MAXIMO}%. O valor unitário é
            arredondado para centavos; o total de cada item é recalculado pelo banco.
          </p>
          {erroPercentual && <p className="text-sm text-red-700">{erroPercentual}</p>}
          {previa && (
            <div className="rounded-md bg-gray-50 p-3 text-sm" data-testid="previa-ajuste">
              <p>
                Soma dos selecionados: <strong>{formatCurrency(previa.antes)}</strong> →{' '}
                <strong>{formatCurrency(previa.depois)}</strong>
              </p>
              {previa.semValor > 0 && (
                <p className="mt-1 text-gray-600">
                  {previa.semValor} {previa.semValor === 1 ? 'item não tem' : 'itens não têm'}{' '}
                  valor unitário e {previa.semValor === 1 ? 'fica' : 'ficam'} como está.
                </p>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2 border-t border-gray-200 pt-4">
            <button
              type="button"
              onClick={() => setAjustando(false)}
              disabled={aplicandoAjuste}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={aplicarAjuste}
              disabled={aplicandoAjuste || percentual === '' || !!erroPercentual}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {aplicandoAjuste ? 'Aplicando...' : 'Aplicar ajuste'}
            </button>
          </div>
        </div>
      </Modal>

      <ItensImportar
        open={importando}
        onOpenChange={setImportando}
        pai={pai}
        itens={itens}
        onImportado={() => router.refresh()}
      />

      {formulario && (
        <ItemForm
          open
          onOpenChange={(o) => !o && setFormulario(null)}
          pai={pai}
          item={formulario.item}
          defaultValues={formulario.defaults}
          numerosEmUso={numerosEmUsoPara(formulario.item)}
          somenteLeitura={!podeEditar}
          onSalvo={() => {
            setFormulario(null)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

// ============================================================
// Linha
// ============================================================

function LinhaItem({
  item,
  editavel,
  podeExcluir,
  selecionado,
  onSelecionar,
  podeSubir,
  podeDescer,
  ocupado,
  onMover,
  onDuplicar,
  estado,
  onSalvar,
  onAbrirFormulario,
  onExcluir,
}: {
  item: Item
  editavel: boolean
  podeExcluir: boolean
  selecionado: boolean
  onSelecionar: () => void
  podeSubir: boolean
  podeDescer: boolean
  ocupado: boolean
  onMover: (direcao: 'subir' | 'descer') => void
  onDuplicar: () => void
  estado: EstadoLinha
  onSalvar: (campos: ItemFormInput) => void
  onAbrirFormulario: () => void
  onExcluir: () => void
}) {
  // Rascunho local da linha. Só sai daqui no blur, e só se mudou — salvar a
  // cada tecla geraria uma requisição por caractere.
  const [rascunho, setRascunho] = useState<ItemFormInput>(() => ({
    numero: item.numero,
    tipo: item.tipo,
    descricao: item.descricao,
    linha: item.linha,
    acabamento: item.acabamento,
    largura: item.largura,
    altura: item.altura,
    quantidade: item.quantidade,
    unidade: item.unidade,
    valor_unit: item.valor_unit,
  }))

  function campo<K extends keyof ItemFormInput>(
    chave: K,
    valor: ItemFormInput[K],
  ) {
    setRascunho((r) => ({ ...r, [chave]: valor }))
  }

  /**
   * Ressincroniza o rascunho quando a linha muda NO BANCO.
   *
   * `useState` só roda o inicializador na montagem, e a chave da linha é o
   * `item.id`, que não muda — então gravar pelo formulário completo (bloco
   * 5.3) atualizava o banco e a linha continuava mostrando o valor antigo. A
   * camada de navegador pegou isso: o modal fechava, o banco tinha R$ 300,00,
   * e a tabela seguia com R$ 750,00.
   *
   * A guarda do `activeElement` é o que separa os dois casos: se o foco está
   * DENTRO desta linha, alguém está digitando (saiu de um campo por Tab e
   * entrou no outro) e sobrescrever apagaria o que está sendo escrito. Se o
   * foco está fora, a origem foi externa e o banco manda.
   */
  const visto = useRef(item.updated_at)
  useEffect(() => {
    if (visto.current === item.updated_at) return
    visto.current = item.updated_at

    const ativo = document.activeElement
    const linhaEmFoco = ativo instanceof HTMLElement && ativo.closest('tr') === linhaRef.current
    if (linhaEmFoco) return

    setRascunho({
      numero: item.numero,
      tipo: item.tipo,
      descricao: item.descricao,
      linha: item.linha,
      acabamento: item.acabamento,
      largura: item.largura,
      altura: item.altura,
      quantidade: item.quantidade,
      unidade: item.unidade,
      valor_unit: item.valor_unit,
    })
  }, [item])

  const linhaRef = useRef<HTMLTableRowElement | null>(null)

  function salvarSeMudou() {
    const mudou = (Object.keys(rascunho) as (keyof ItemFormInput)[]).some(
      (k) => rascunho[k] !== item[k as keyof Item],
    )
    if (mudou) onSalvar(rascunho)
  }

  // Área e valor total são colunas GENERATED: o banco é quem manda. Enquanto
  // a linha não voltou do servidor, mostramos a previsão local para o número
  // não ficar defasado enquanto a pessoa digita.
  const areaPrevista =
    areaDoItem(rascunho.largura, rascunho.altura, rascunho.quantidade) ??
    item.area_m2
  const totalPrevisto =
    valorTotalDoItem(rascunho.valor_unit, rascunho.quantidade) ??
    item.valor_total

  return (
    <tr ref={linhaRef} className={selecionado ? 'bg-blue-50' : 'hover:bg-gray-50'}>
      <Td>
        {editavel && (
          <input
            type="checkbox"
            checked={selecionado}
            onChange={onSelecionar}
            aria-label={`Selecionar o item ${item.numero ?? ''}`.trim()}
            className="h-4 w-4 rounded border-gray-300"
          />
        )}
      </Td>
      <Td>
        <div className="flex items-center gap-0.5">
          <NumeroInput
            valor={rascunho.numero}
            rotulo="Número do item"
            editavel={editavel}
            onChange={(v) => campo('numero', v)}
            onBlur={salvarSeMudou}
            className="text-right"
          />
          {/*
            Sobe/desce troca o número com o vizinho (bloco 5.7). Só para item
            com número: o sem número fica no fim, fora da sequência.
          */}
          {editavel && item.numero !== null && (
            <div className="flex flex-col">
              <button
                type="button"
                onClick={() => onMover('subir')}
                disabled={!podeSubir || ocupado}
                aria-label={`Subir o item ${item.numero}`}
                className="rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onMover('descer')}
                disabled={!podeDescer || ocupado}
                aria-label={`Descer o item ${item.numero}`}
                className="rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </Td>
      <Td>
        <TextoInput
          valor={rascunho.tipo}
          rotulo="Tipo"
          editavel={editavel}
          onChange={(v) => campo('tipo', v)}
          onBlur={salvarSeMudou}
        />
      </Td>
      <Td>
        <TextoInput
          valor={rascunho.descricao}
          rotulo="Descrição"
          editavel={editavel}
          onChange={(v) => campo('descricao', v)}
          onBlur={salvarSeMudou}
        />
      </Td>
      <Td>
        <TextoInput
          valor={rascunho.linha}
          rotulo="Linha"
          editavel={editavel}
          onChange={(v) => campo('linha', v)}
          onBlur={salvarSeMudou}
        />
      </Td>
      <Td>
        <TextoInput
          valor={rascunho.acabamento}
          rotulo="Acabamento"
          editavel={editavel}
          onChange={(v) => campo('acabamento', v)}
          onBlur={salvarSeMudou}
        />
      </Td>
      <Td className="text-right">
        <NumeroInput
          valor={rascunho.largura}
          rotulo="Largura"
          editavel={editavel}
          leitura="dimensao"
          decimal
          onChange={(v) => campo('largura', v)}
          onBlur={salvarSeMudou}
          className="text-right"
        />
      </Td>
      <Td className="text-right">
        <NumeroInput
          valor={rascunho.altura}
          rotulo="Altura"
          editavel={editavel}
          leitura="dimensao"
          decimal
          onChange={(v) => campo('altura', v)}
          onBlur={salvarSeMudou}
          className="text-right"
        />
      </Td>
      <Td className="text-right">
        <NumeroInput
          valor={rascunho.quantidade}
          rotulo="Quantidade"
          editavel={editavel}
          decimal
          onChange={(v) => campo('quantidade', v)}
          onBlur={salvarSeMudou}
          className="text-right"
        />
      </Td>
      <Td>
        {editavel ? (
          <select
            value={rascunho.unidade ?? ''}
            onChange={(e) => {
              const v = e.target.value
              campo('unidade', v === '' ? null : (v as Unidade))
            }}
            onBlur={salvarSeMudou}
            aria-label="Unidade"
            title={formatUnidade(rascunho.unidade)}
            className="w-full rounded border border-transparent bg-transparent px-1 py-1 text-sm hover:border-gray-300 focus:border-blue-500 focus:bg-white focus:outline-none"
          >
            <option value="">—</option>
            {UNIDADES.map((u) => (
              <option key={u} value={u} title={UNIDADE_LABELS[u]}>
                {formatUnidadeSufixo(u)}
              </option>
            ))}
          </select>
        ) : (
          <span className="px-1" title={formatUnidade(rascunho.unidade)}>
            {formatUnidadeSufixo(rascunho.unidade) || '—'}
          </span>
        )}
      </Td>
      {/* Área e valor total não têm input: são calculados pelo banco. */}
      <Td className="whitespace-nowrap text-right text-gray-600">{formatArea(areaPrevista)}</Td>
      <Td className="text-right">
        <NumeroInput
          valor={rascunho.valor_unit}
          rotulo="Valor unitário"
          editavel={editavel}
          leitura="moeda"
          decimal
          onChange={(v) => campo('valor_unit', v)}
          onBlur={salvarSeMudou}
          className="text-right"
        />
      </Td>
      <Td className="whitespace-nowrap text-right font-medium text-gray-900">
        {formatCurrency(totalPrevisto)}
      </Td>
      <Td>
        <div className="flex items-center justify-end gap-0.5">
          <IndicadorEstado estado={estado} />
          {/*
            Para todos: quem não pode editar abre o formulário em modo
            leitura. É o único lugar onde localização, vidros e observação
            aparecem — a tabela não tem essas colunas.
          */}
          <button
            type="button"
            onClick={onAbrirFormulario}
            aria-label={`${editavel ? 'Abrir formulário' : 'Ver todos os campos'} do item ${item.numero ?? ''}`.trim()}
            title={editavel ? 'Formulário completo (localização, vidros, observação)' : 'Ver todos os campos do item'}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            {editavel ? <Pencil className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
          {editavel && (
            <button
              type="button"
              onClick={onDuplicar}
              disabled={ocupado}
              aria-label={`Duplicar o item ${item.numero ?? ''}`.trim()}
              title="Duplicar (a cópia vai para o fim, com o próximo número)"
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
            >
              <Copy className="h-4 w-4" />
            </button>
          )}
          {podeExcluir && (
            <button
              type="button"
              onClick={onExcluir}
              aria-label={`Excluir item ${item.numero ?? ''}`.trim()}
              className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </Td>
    </tr>
  )
}

function IndicadorEstado({ estado }: { estado: EstadoLinha }) {
  if (estado === 'salvando') {
    return (
      <span title="Salvando" aria-label="Salvando">
        <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
      </span>
    )
  }
  if (estado === 'salvo') {
    return (
      <span title="Salvo" aria-label="Salvo">
        <Check className="h-4 w-4 text-green-600" />
      </span>
    )
  }
  return <span className="inline-block h-4 w-4" />
}

// ============================================================
// Inputs de célula
// ============================================================

const CELULA =
  'w-full rounded border border-transparent bg-transparent px-1 py-1 text-sm hover:border-gray-300 focus:border-blue-500 focus:bg-white focus:outline-none'

/**
 * Esconde as setinhas do `input[type=number]`.
 *
 * Não é preciosismo: elas consomem ~17px de largura, e na coluna Nº (48px)
 * empurravam o dígito para fora da área visível — a conferência visual de
 * 2026-09-21 mostrou a coluna Nº inteira aparentemente VAZIA, com os números
 * gravados corretamente no banco. Numa tabela densa elas também são
 * inclicáveis, então não se perde função.
 */
const SEM_SPINNER =
  '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0'

function TextoInput({
  valor,
  rotulo,
  editavel,
  onChange,
  onBlur,
}: {
  valor: string | null
  rotulo: string
  editavel: boolean
  onChange: (v: string | null) => void
  onBlur: () => void
}) {
  if (!editavel) return <span className="px-1">{valor ?? '—'}</span>
  return (
    <input
      type="text"
      value={valor ?? ''}
      aria-label={rotulo}
      title={valor ?? undefined}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      onBlur={onBlur}
      className={CELULA}
    />
  )
}

function NumeroInput({
  valor,
  rotulo,
  editavel,
  decimal = false,
  onChange,
  onBlur,
  className = '',
  leitura = 'cru',
}: {
  valor: number | null
  rotulo: string
  editavel: boolean
  decimal?: boolean
  onChange: (v: number | null) => void
  onBlur: () => void
  className?: string
  /** Como mostrar quando não é editável. 'dimensao' usa metros. */
  leitura?: 'cru' | 'dimensao' | 'moeda'
}) {
  if (!editavel) {
    if (leitura === 'dimensao') {
      return <span className="px-1">{formatDimensao(valor)}</span>
    }
    if (leitura === 'moeda') {
      return <span className="px-1">{formatCurrency(valor)}</span>
    }
    return <span className="px-1">{valor ?? '—'}</span>
  }
  return (
    <input
      type="number"
      step={decimal ? '0.001' : '1'}
      value={valor ?? ''}
      aria-label={rotulo}
      onChange={(e) => {
        const bruto = e.target.value
        if (bruto === '') return onChange(null)
        const n = Number(bruto)
        // Campo numérico vazio ou inválido vira null, nunca 0 — zero é um
        // valor plausível que o banco aceitaria como verdade.
        onChange(Number.isNaN(n) ? null : n)
      }}
      onBlur={onBlur}
      className={`${CELULA} ${SEM_SPINNER} ${className}`}
    />
  )
}

function Th({
  children,
  className = '',
}: {
  children?: React.ReactNode
  className?: string
}) {
  return (
    <th
      className={`px-2 py-2 text-left text-xs font-medium uppercase tracking-wide ${className}`}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  className = '',
}: {
  children?: React.ReactNode
  className?: string
}) {
  // px-2 e não px-3: com 14 colunas em ~1136px, 8px de padding a menos por
  // célula é o que faz Tipo, Linha e Acabamento caberem inteiros. A conferência
  // visual do 5.5 mostrou "Guarda-", "Escovad", "Cromadc" com px-3.
  return <td className={`px-2 py-1.5 ${className}`}>{children}</td>
}
