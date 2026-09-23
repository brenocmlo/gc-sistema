'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import Link from 'next/link'
import type { ReactNode } from 'react'
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
  contratoSchema,
  type ContratoFormValues,
} from '@/lib/contratos-form'

/**
 * Com itens, `valor_total` é a soma deles (trigger do 5.6, que vale para
 * contrato também) e a obra não pode mudar (FK composta dos itens). Passam
 * isto a edição de contrato com itens e o "Gerar contrato" com cópia de itens.
 */
export type TravaPorItens = { quantidade: number; soma: number }

type ContratoFormProps = {
  defaultValues: ContratoFormValues
  obraOptions: readonly { value: string; label: string }[]
  submitLabel: string
  cancelHref: string
  /** Chamado com os valores validados. Responsável por toast + navegação. */
  onSubmit: (values: ContratoFormValues) => Promise<void>
  travadoPorItens?: TravaPorItens | null
  /**
   * Obra fixa sem ser por itens: no "Gerar contrato", a obra é a da proposta
   * — a FK `contratos_proposta_fk` exige a mesma obra.
   */
  obraTravadaMotivo?: string | null
  /** Seção a mais antes dos botões (o "copiar itens" do bloco 6.2). */
  extra?: ReactNode
}

export default function ContratoForm({
  defaultValues,
  obraOptions,
  submitLabel,
  cancelHref,
  onSubmit,
  travadoPorItens = null,
  obraTravadaMotivo = null,
  extra = null,
}: ContratoFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ContratoFormValues>({
    resolver: zodResolver(contratoSchema),
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
          hint="Único por empresa. Ex: CT-2026-001"
          error={errors.numero?.message}
        >
          <Input
            id="numero"
            type="text"
            placeholder="CT-2026-001"
            disabled={isSubmitting}
            {...register('numero')}
          />
        </FormField>

        <FormField
          label="Obra"
          htmlFor="obra_id"
          required
          hint={
            obraTravadaMotivo
              ? obraTravadaMotivo
              : travadoPorItens
                ? 'Travada: os itens deste contrato pertencem a esta obra'
                : obraOptions.length === 0
                  ? 'Nenhuma obra cadastrada ainda — cadastre uma antes'
                  : 'O cliente do contrato é o cliente da obra'
          }
          error={errors.obra_id?.message}
        >
          <Select
            id="obra_id"
            options={obraOptions}
            placeholder="— Selecione uma obra —"
            disabled={isSubmitting || obraOptions.length === 0}
            {...register('obra_id')}
            {...(travadoPorItens || obraTravadaMotivo
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
          hint="Escopo do contrato, até 2000 caracteres"
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
          label="Data de assinatura"
          htmlFor="data_assinatura"
          hint="Opcional: em branco enquanto o contrato não foi assinado"
          error={errors.data_assinatura?.message}
        >
          <Input
            id="data_assinatura"
            type="date"
            disabled={isSubmitting}
            {...register('data_assinatura')}
          />
        </FormField>

        <FormField
          label="Prazo de execução"
          htmlFor="prazo_execucao"
          hint="Texto livre. Ex: 45 dias corridos a partir da assinatura"
          error={errors.prazo_execucao?.message}
        >
          <Input
            id="prazo_execucao"
            type="text"
            disabled={isSubmitting}
            {...register('prazo_execucao')}
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
            // Desconto acima do valor: o erro já aparece no campo Desconto, e
            // um valor final negativo só confundia. O banco recusa esse caso.
            value={valorFinal < 0 ? '—' : formatCurrency(valorFinal)}
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

      {extra}

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
