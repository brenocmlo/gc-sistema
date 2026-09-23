'use client'

import { Check, Eye, Loader2, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import ConfirmDialog from '@/components/ConfirmDialog'
import { formatCurrency } from '@/lib/format'
import {
  UNIDADES,
  UNIDADE_LABELS,
  areaDoItem,
  divergenciaDeValor,
  formatArea,
  formatDimensao,
  formatUnidade,
  formatUnidadeSufixo,
  proximoNumeroItem,
  totaisDosItens,
  valorTotalDoItem,
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
  createItem,
  deleteItem,
  sincronizarValorComItens,
  updateItem,
  type ItemFormInput,
} from './itens-actions'

type ItensTabProps = {
  propostaId: string
  itens: Item[]
  /** `valor_total` da proposta, para o aviso de divergência (bloco 5.6). */
  valorTotalProposta: number | null
  /** Desconto da proposta: soma abaixo dele é divergência esperada. */
  descontoProposta: number | null
  perfil: Perfil
  /** Proposta fora de rascunho vira somente-leitura, como o botão Editar. */
  editavel: boolean
}

/** Estado de salvamento de uma linha, para o indicador salvo/salvando. */
type EstadoLinha = 'parado' | 'salvando' | 'salvo' | 'erro'

export default function ItensTab({
  propostaId,
  itens,
  valorTotalProposta,
  descontoProposta,
  perfil,
  editavel,
}: ItensTabProps) {
  const router = useRouter()
  const [excluindo, setExcluindo] = useState<Item | null>(null)
  /** null = fechado; { item: null } = criar; { item } = editar. */
  const [formulario, setFormulario] = useState<{
    item: Item | null
    defaults: ItemFormValues
  } | null>(null)
  const [estados, setEstados] = useState<Record<string, EstadoLinha>>({})
  const [adicionando, setAdicionando] = useState(false)
  const [importando, setImportando] = useState(false)

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
    const r = await updateItem(propostaId, item.id, campos, visto)

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
    const r = await createItem(propostaId, {
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
    const r = await deleteItem(propostaId, excluindo.id)
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
  const divergencia = divergenciaDeValor(valorTotalProposta, itens, descontoProposta)
  const [sincronizando, setSincronizando] = useState(false)

  async function sincronizar() {
    setSincronizando(true)
    const r = await sincronizarValorComItens(propostaId)
    setSincronizando(false)
    if (!r.ok) {
      toast.error(r.error, { duration: 8000 })
      return
    }
    toast.success('Valor total da proposta ajustado para a soma dos itens')
    router.refresh()
  }

  if (itens.length === 0 && !podeEditar) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-500">
        Esta proposta não tem itens.
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
              alcança o desconto da proposta ({formatCurrency(descontoProposta)}).
              Enquanto isso, vale o valor digitado (
              {formatCurrency(valorTotalProposta)}); quando a soma passar do
              desconto, o valor total passa a acompanhá-la sozinho.
            </p>
          ) : (
            <p>
              O valor total da proposta ({formatCurrency(valorTotalProposta)}) é
              diferente da soma dos itens ({formatCurrency(divergencia.soma)}):{' '}
              {divergencia.diferenca > 0 ? 'sobram' : 'faltam'}{' '}
              {formatCurrency(Math.abs(divergencia.diferenca))}. Isto acontece
              com proposta anterior ao recálculo automático ou alterada fora do
              sistema.
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

      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table
          aria-label="Itens da proposta"
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
            Soma = 1108px (48+116+144+92+96+56+56+56+64+88+104+112+76), calibrada para caber no desktop de 1440 (que sobra
            ~1136 depois da sidebar de 240 e do padding de 64). A primeira
            calibragem usou 1300 e empurrou "Valor total" para fora da tela —
            a coluna que mais importa exigindo rolagem. Descrição é a que cede
            espaço, porque é texto livre e tem `title` com o valor inteiro.
          */}
          <colgroup>
            <col className="w-[48px]" />
            <col className="w-[116px]" />
            <col className="w-[144px]" />
            <col className="w-[92px]" />
            <col className="w-[96px]" />
            <col className="w-[56px]" />
            <col className="w-[56px]" />
            <col className="w-[56px]" />
            <col className="w-[64px]" />
            <col className="w-[88px]" />
            <col className="w-[104px]" />
            <col className="w-[112px]" />
            <col className="w-[76px]" />
          </colgroup>
          <thead className="bg-gray-50 text-gray-600">
            <tr>
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
                  colSpan={13}
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
                <td className="px-3 py-2" colSpan={7}>
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
          A proposta saiu de rascunho: os itens ficam somente leitura.
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
              } será removido permanentemente da proposta.`.replace(/\s+/g, ' ')
            : ''
        }
        variant="danger"
        confirmLabel="Excluir"
        onConfirm={confirmarExclusao}
      />


      <ItensImportar
        open={importando}
        onOpenChange={setImportando}
        propostaId={propostaId}
        itens={itens}
        onImportado={() => router.refresh()}
      />

      {formulario && (
        <ItemForm
          open
          onOpenChange={(o) => !o && setFormulario(null)}
          propostaId={propostaId}
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
  estado,
  onSalvar,
  onAbrirFormulario,
  onExcluir,
}: {
  item: Item
  editavel: boolean
  podeExcluir: boolean
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
    <tr ref={linhaRef} className="hover:bg-gray-50">
      <Td>
        <NumeroInput
          valor={rascunho.numero}
          rotulo="Número do item"
          editavel={editavel}
          onChange={(v) => campo('numero', v)}
          onBlur={salvarSeMudou}
          className="text-right"
        />
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
        <div className="flex items-center justify-end gap-1">
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
