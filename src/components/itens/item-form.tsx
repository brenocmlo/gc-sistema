'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'

import Modal from '@/components/Modal'
import FormField from '@/components/form/FormField'
import FormSection from '@/components/form/FormSection'
import Input from '@/components/form/Input'
import Select from '@/components/form/Select'
import Textarea from '@/components/form/Textarea'
import { formatCurrency } from '@/lib/format'
import { UNIDADES, UNIDADE_LABELS, areaDoItem, valorTotalDoItem } from '@/lib/itens'
import {
  criarItemFormSchema,
  itemFormParaPayload,
  type ItemFormValues,
} from '@/lib/itens-form'
import type { Item } from '@/lib/types'

import { createItem, updateItem } from './itens-actions'

const UNIDADE_OPTIONS = UNIDADES.map((u) => ({
  value: u,
  label: UNIDADE_LABELS[u],
}))

type ItemFormProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  propostaId: string
  /** null = criar; item = editar. */
  item: Item | null
  defaultValues: ItemFormValues
  /** Números usados pelos OUTROS itens — avisa antes do unique do banco. */
  numerosEmUso: readonly number[]
  onSalvo: () => void
  /**
   * Abre o item só para leitura. Existe porque a tabela não mostra
   * `localizacao`, `vidros` e `observacao`: sem este modo, o visualizador e
   * qualquer pessoa diante de uma proposta fora de rascunho não tinham como
   * ver esses três campos (pendência do 5.3, fechada no fim da sprint 5).
   */
  somenteLeitura?: boolean
}

/**
 * Formulário completo do item (bloco 5.3).
 *
 * Complementa a tabela do 5.2, não a substitui: a tabela é para edição rápida
 * das 12 colunas que caibam nela, e este formulário é para os campos que não
 * cabem — `localizacao`, `vidros`, `observacao` — e para quem prefere um
 * formulário a editar célula por célula.
 *
 * Modal e não página dedicada: página nova significaria rota nova
 * (`scripts/rotas-esperadas.txt` de 31 para 32) e sair do detalhe da proposta
 * para voltar depois. O modal mantém a tabela atrás, visível.
 */
export default function ItemForm({
  open,
  onOpenChange,
  propostaId,
  item,
  defaultValues,
  numerosEmUso,
  onSalvo,
  somenteLeitura = false,
}: ItemFormProps) {
  // O schema depende dos números em uso, então é recriado quando eles mudam.
  const schema = useMemo(
    () => criarItemFormSchema({ numerosEmUso }),
    [numerosEmUso],
  )

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ItemFormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  })

  // Área e valor total em runtime, com a MESMA fórmula das colunas GENERATED
  // (`areaDoItem`/`valorTotalDoItem`, do bloco 5.1). É previsão: o valor que
  // vale é o que o banco devolve depois de gravar.
  const largura = useWatch({ control, name: 'largura' })
  const altura = useWatch({ control, name: 'altura' })
  const quantidade = useWatch({ control, name: 'quantidade' })
  const valorUnit = useWatch({ control, name: 'valor_unit' })

  const num = (v: unknown): number | null => {
    if (v === '' || v === null || v === undefined) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  const areaPrevista = areaDoItem(num(largura), num(altura), num(quantidade))
  const totalPrevisto = valorTotalDoItem(num(valorUnit), num(quantidade))

  async function onSubmit(values: ItemFormValues) {
    // `values` chega pelo resolver, então já passou pelo schema — mas o
    // `handleSubmit` entrega o INPUT, não a saída transformada. Reparsear aqui
    // é o que converte '' em null e garante o tipo do payload.
    const parsed = schema.safeParse(values)
    if (!parsed.success) {
      toast.error('Confira os campos destacados')
      return
    }

    const payload = itemFormParaPayload(parsed.data)

    const r = item
      ? await updateItem(propostaId, item.id, payload, item.updated_at)
      : await createItem(propostaId, payload)

    if (!r.ok) {
      toast.error(r.error, { duration: 8000 })
      return
    }

    toast.success(item ? 'Item atualizado' : 'Item adicionado')
    onOpenChange(false)
    reset(defaultValues)
    onSalvo()
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) reset(defaultValues)
        onOpenChange(o)
      }}
      title={
        somenteLeitura
          ? `Item ${item?.numero ?? ''}`.trim()
          : item
            ? `Editar item ${item.numero ?? ''}`.trim()
            : 'Novo item'
      }
      size="lg"
      dismissible={!isSubmitting}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
        {/* `fieldset disabled` desliga todos os campos de uma vez no modo leitura. */}
        <fieldset disabled={somenteLeitura} className="space-y-6">
        <FormSection title="Identificação">
          <FormField
            label="Número"
            htmlFor="item_numero"
            hint="Inteiro, único nesta proposta. Em branco se o documento não numera."
            error={errors.numero?.message}
          >
            <Input
              id="item_numero"
              type="number"
              step="1"
              min="1"
              disabled={isSubmitting}
              {...register('numero')}
            />
          </FormField>

          <FormField label="Tipo" htmlFor="item_tipo" error={errors.tipo?.message}>
            <Input
              id="item_tipo"
              type="text"
              placeholder="Janela, Porta, Guarda-corpo…"
              disabled={isSubmitting}
              {...register('tipo')}
            />
          </FormField>

          <FormField
            label="Descrição"
            htmlFor="item_descricao"
            className="md:col-span-2"
            error={errors.descricao?.message}
          >
            <Textarea
              id="item_descricao"
              rows={2}
              disabled={isSubmitting}
              {...register('descricao')}
            />
          </FormField>

          <FormField label="Linha" htmlFor="item_linha" error={errors.linha?.message}>
            <Input
              id="item_linha"
              type="text"
              disabled={isSubmitting}
              {...register('linha')}
            />
          </FormField>

          <FormField
            label="Acabamento"
            htmlFor="item_acabamento"
            error={errors.acabamento?.message}
          >
            <Input
              id="item_acabamento"
              type="text"
              disabled={isSubmitting}
              {...register('acabamento')}
            />
          </FormField>

          <FormField
            label="Localização"
            htmlFor="item_localizacao"
            hint="Onde na obra — fachada, pavimento, ambiente."
            error={errors.localizacao?.message}
          >
            <Input
              id="item_localizacao"
              type="text"
              disabled={isSubmitting}
              {...register('localizacao')}
            />
          </FormField>

          <FormField
            label="Vidros"
            htmlFor="item_vidros"
            hint="Especificação do vidro, quando houver."
            error={errors.vidros?.message}
          >
            <Input
              id="item_vidros"
              type="text"
              disabled={isSubmitting}
              {...register('vidros')}
            />
          </FormField>
        </FormSection>

        <FormSection title="Dimensões e valores">
          <FormField
            label="Largura (m)"
            htmlFor="item_largura"
            error={errors.largura?.message}
          >
            <Input
              id="item_largura"
              type="number"
              step="0.001"
              min="0"
              disabled={isSubmitting}
              {...register('largura')}
            />
          </FormField>

          <FormField
            label="Altura (m)"
            htmlFor="item_altura"
            error={errors.altura?.message}
          >
            <Input
              id="item_altura"
              type="number"
              step="0.001"
              min="0"
              disabled={isSubmitting}
              {...register('altura')}
            />
          </FormField>

          <FormField
            label="Quantidade"
            htmlFor="item_quantidade"
            required
            error={errors.quantidade?.message}
          >
            <Input
              id="item_quantidade"
              type="number"
              step="0.001"
              min="0"
              disabled={isSubmitting}
              {...register('quantidade')}
            />
          </FormField>

          <FormField
            label="Unidade"
            htmlFor="item_unidade"
            required
            error={errors.unidade?.message}
          >
            <Select
              id="item_unidade"
              options={UNIDADE_OPTIONS}
              disabled={isSubmitting}
              {...register('unidade')}
            />
          </FormField>

          <FormField
            label="Valor unitário"
            htmlFor="item_valor_unit"
            hint="Em branco se o documento só traz o valor total."
            error={errors.valor_unit?.message}
          >
            <Input
              id="item_valor_unit"
              type="number"
              step="0.01"
              min="0"
              disabled={isSubmitting}
              {...register('valor_unit')}
            />
          </FormField>

          {/*
            Área e valor total NÃO são campos: são colunas GENERATED
            (valor_unit × quantidade e largura × altura × quantidade). Aqui
            aparecem como leitura, calculadas com a mesma fórmula do banco,
            para a pessoa ver o efeito do que digita antes de salvar.
          */}
          <div
            className="md:col-span-2 grid grid-cols-2 gap-4 rounded-md bg-gray-50 p-4"
            data-testid="item-form-calculados"
          >
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Área m² (calculada)
              </p>
              <p className="mt-1 text-sm text-gray-900" id="item_area_calculada">
                {areaPrevista === null
                  ? '—'
                  : `${areaPrevista.toLocaleString('pt-BR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} m²`}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Valor total (calculado)
              </p>
              <p
                className="mt-1 text-sm font-medium text-gray-900"
                id="item_total_calculado"
              >
                {totalPrevisto === null ? '—' : formatCurrency(totalPrevisto)}
              </p>
            </div>
            <p className="col-span-2 text-xs text-gray-500">
              As duas são calculadas pelo banco ao salvar. O que aparece aqui é
              previsão, com a mesma fórmula.
            </p>
          </div>
        </FormSection>

        <FormSection title="Observação">
          <FormField
            label="Observação"
            htmlFor="item_observacao"
            className="md:col-span-2"
            error={errors.observacao?.message}
          >
            <Textarea
              id="item_observacao"
              rows={3}
              disabled={isSubmitting}
              {...register('observacao')}
            />
          </FormField>
        </FormSection>

        </fieldset>

        <div className="flex justify-end gap-2 border-t border-gray-200 pt-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {somenteLeitura ? 'Fechar' : 'Cancelar'}
          </button>
          {!somenteLeitura && (
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {isSubmitting ? 'Salvando...' : 'Salvar item'}
          </button>
          )}
        </div>
      </form>
    </Modal>
  )
}
