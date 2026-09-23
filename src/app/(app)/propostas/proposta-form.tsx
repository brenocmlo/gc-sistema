'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import Link from 'next/link'
import { useForm } from 'react-hook-form'

import FormField from '@/components/form/FormField'
import FormSection from '@/components/form/FormSection'
import Input from '@/components/form/Input'
import Select from '@/components/form/Select'
import Textarea from '@/components/form/Textarea'
import { formatCurrency } from '@/lib/format'
import {
  PCT_FIELDS,
  PCT_LABELS,
  calcularValorFinal,
  validarSomaPctForm,
} from '@/lib/propostas'

import {
  propostaSchema,
  type PropostaFormValues,
} from './proposta-form-helpers'

/**
 * Bloco 5.6: com itens, `valor_total` é a soma deles (trigger no banco) e a obra
 * não pode mudar (FK composta dos itens). A criação nunca tem itens, então só
 * a edição passa isto.
 */
export type TravaPorItens = { quantidade: number; soma: number }

type PropostaFormProps = {
  defaultValues: PropostaFormValues
  obraOptions: readonly { value: string; label: string }[]
  submitLabel: string
  cancelHref: string
  /** Chamado com os valores validados. Responsável por toast + navegação. */
  onSubmit: (values: PropostaFormValues) => Promise<void>
  travadoPorItens?: TravaPorItens | null
}

export default function PropostaForm({
  defaultValues,
  obraOptions,
  submitLabel,
  cancelHref,
  onSubmit,
  travadoPorItens = null,
}: PropostaFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<PropostaFormValues>({
    resolver: zodResolver(propostaSchema),
    defaultValues,
  })

  // Prévia do que o banco vai gravar: valor_final é coluna generated, então a
  // tela mostra o cálculo mas nunca o envia.
  const valorTotal = Number(watch('valor_total') ?? 0)
  const desconto = Number(watch('desconto') ?? 0)
  const valorFinal = calcularValorFinal(valorTotal, desconto)

  const pctValues = {
    pct_sinal: Number(watch('pct_sinal') ?? 0),
    pct_fd: Number(watch('pct_fd') ?? 0),
    pct_entrega_material: Number(watch('pct_entrega_material') ?? 0),
    pct_medicao_instalacao: Number(watch('pct_medicao_instalacao') ?? 0),
  }
  const soma = validarSomaPctForm(pctValues)
  const somaPercentual = Math.round(soma.soma * 10_000) / 100
  const restantePercentual = Math.round(soma.restante * 10_000) / 100

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="max-w-3xl mx-auto bg-white rounded-lg border border-gray-200 shadow-sm p-8 space-y-8"
      noValidate
    >
      <FormSection title="Identificação">
        <FormField
          label="Número"
          htmlFor="numero"
          required
          hint="Único por empresa. Ex: PROP-2026-001"
          error={errors.numero?.message}
        >
          <Input
            id="numero"
            type="text"
            placeholder="PROP-2026-001"
            disabled={isSubmitting}
            {...register('numero')}
          />
        </FormField>

        <FormField
          label="Obra"
          htmlFor="obra_id"
          required
          hint={
            travadoPorItens
              ? 'Travada: os itens desta proposta pertencem a esta obra'
              : obraOptions.length === 0
                ? 'Nenhuma obra cadastrada ainda — cadastre uma antes'
                : 'O cliente da proposta é o cliente da obra'
          }
          error={errors.obra_id?.message}
        >
          <Select
            id="obra_id"
            options={obraOptions}
            placeholder="— Selecione uma obra —"
            disabled={isSubmitting || obraOptions.length === 0}
            {...register('obra_id')}
            {...(travadoPorItens
              ? {
                  'aria-readonly': true,
                  tabIndex: -1,
                  className: 'pointer-events-none bg-gray-100',
                }
              : {})}
          />
        </FormField>

        <FormField
          label="Descrição"
          htmlFor="descricao"
          hint="Escopo da proposta, até 2000 caracteres"
          error={errors.descricao?.message}
          className="md:col-span-2"
        >
          <Textarea
            id="descricao"
            rows={4}
            disabled={isSubmitting}
            {...register('descricao')}
          />
        </FormField>
      </FormSection>

      <FormSection title="Datas">
        <FormField
          label="Data de emissão"
          htmlFor="data_emissao"
          required
          error={errors.data_emissao?.message}
        >
          <Input
            id="data_emissao"
            type="date"
            disabled={isSubmitting}
            {...register('data_emissao')}
          />
        </FormField>

        <FormField
          label="Validade"
          htmlFor="data_validade"
          hint="Opcional. Depois dessa data a proposta aparece como vencida"
          error={errors.data_validade?.message}
        >
          <Input
            id="data_validade"
            type="date"
            disabled={isSubmitting}
            {...register('data_validade')}
          />
        </FormField>

      </FormSection>

      <FormSection title="Valores">
        <FormField
          label="Valor total (R$)"
          htmlFor="valor_total"
          hint={
            travadoPorItens
              ? `Soma dos ${travadoPorItens.quantidade} ${
                  travadoPorItens.quantidade === 1 ? 'item' : 'itens'
                } — muda pela aba Itens`
              : undefined
          }
          error={errors.valor_total?.message}
        >
          <Input
            id="valor_total"
            type="number"
            step="0.01"
            min="0"
            disabled={isSubmitting}
            readOnly={!!travadoPorItens}
            className={travadoPorItens ? 'bg-gray-100' : ''}
            {...register('valor_total', { valueAsNumber: true })}
          />
        </FormField>

        <FormField
          label="Desconto (R$)"
          htmlFor="desconto"
          hint="Não pode passar do valor total"
          error={errors.desconto?.message}
        >
          <Input
            id="desconto"
            type="number"
            step="0.01"
            min="0"
            disabled={isSubmitting}
            {...register('desconto', { valueAsNumber: true })}
          />
        </FormField>

        {/* Read-only e fora do payload: valor_final é coluna generated no
            banco (valor_total - desconto). O input existe só pra conferência. */}
        <FormField
          label="Valor final"
          htmlFor="valor_final_preview"
          hint="Calculado pelo banco: valor total menos desconto"
          className="md:col-span-2"
        >
          <Input
            id="valor_final_preview"
            type="text"
            readOnly
            disabled
            tabIndex={-1}
            value={formatCurrency(valorFinal)}
          />
        </FormField>
      </FormSection>

      <FormSection
        title="Condições de pagamento"
        description="Percentuais do valor final. A soma não pode passar de 100% — o que sobrar fica pro campo livre abaixo."
      >
        {PCT_FIELDS.map((field) => (
          <FormField
            key={field}
            label={`${PCT_LABELS[field]} (%)`}
            htmlFor={field}
            error={errors[field]?.message}
          >
            <Input
              id={field}
              type="number"
              step="0.01"
              min="0"
              max="100"
              disabled={isSubmitting}
              {...register(field, { valueAsNumber: true })}
            />
          </FormField>
        ))}

        <div
          className={`md:col-span-2 rounded-md px-4 py-3 flex items-center justify-between border ${
            soma.ok
              ? 'bg-gray-50 border-gray-200'
              : 'bg-red-50 border-red-200'
          }`}
        >
          <span className="text-sm text-gray-600">
            Soma das parcelas
            {soma.ok && restantePercentual > 0 && (
              <span className="text-gray-500">
                {' '}
                · restam {restantePercentual.toLocaleString('pt-BR')}% em aberto
              </span>
            )}
          </span>
          <span
            className={`text-sm font-semibold tabular-nums ${
              soma.ok ? 'text-gray-900' : 'text-red-700'
            }`}
          >
            {somaPercentual.toLocaleString('pt-BR')}%
          </span>
        </div>

        <FormField
          label="Condições livres"
          htmlFor="condicoes_pagamento"
          hint="Texto para o que não cabe em percentual"
          error={errors.condicoes_pagamento?.message}
          className="md:col-span-2"
        >
          <Textarea
            id="condicoes_pagamento"
            rows={3}
            disabled={isSubmitting}
            {...register('condicoes_pagamento')}
          />
        </FormField>
      </FormSection>

      <FormSection title="Observações">
        <FormField
          label="Observações"
          htmlFor="observacao"
          error={errors.observacao?.message}
          className="md:col-span-2"
        >
          <Textarea
            id="observacao"
            rows={3}
            disabled={isSubmitting}
            {...register('observacao')}
          />
        </FormField>
      </FormSection>

      <section className="space-y-4">
        <header className="pb-2 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900">Anexos</h2>
        </header>
        <p className="text-sm text-gray-500">
          Anexos podem ser gerenciados na aba &ldquo;Anexos&rdquo; da tela de
          detalhes.
        </p>
      </section>

      <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
        <Link
          href={cancelHref}
          className="px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Cancelar
        </Link>
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-4 py-2 rounded-md bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Salvando...' : submitLabel}
        </button>
      </div>
    </form>
  )
}
