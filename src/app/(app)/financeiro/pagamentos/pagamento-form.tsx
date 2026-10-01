'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'

import FormField from '@/components/form/FormField'
import FormSection from '@/components/form/FormSection'
import Input from '@/components/form/Input'
import Select from '@/components/form/Select'
import Textarea from '@/components/form/Textarea'
import { formatCurrency } from '@/lib/format'
import { FORMA_PAGAMENTO_OPTIONS, ORIGEM_PAGAMENTO_OPTIONS } from '@/lib/pagamentos'
import { avisoDeExcesso, pagamentoSchema, type PagamentoFormValues } from '@/lib/pagamentos-form'
import type { PagamentoOrigem } from '@/lib/types'

import type { OpcoesDePagamento } from './opcoes'

const ORIGEM_DICA: Record<PagamentoOrigem, string> = {
  nf: 'Baixa de uma nota fiscal da obra.',
  acordo: 'Parcela de um acordo de pagamento, sem NF.',
  avulso: 'Dinheiro sem nota nem acordo: a observação diz do que é.',
}

type PagamentoFormProps = OpcoesDePagamento & {
  defaultValues: PagamentoFormValues
  obraOptions: readonly { value: string; label: string }[]
  submitLabel: string
  cancelHref: string
  onSubmit: (values: PagamentoFormValues) => Promise<void>
}

/**
 * Formulário de pagamento (10.2). A constraint pagamento_vinculo_consistente
 * tem três combinações válidas; o radio de origem mostra só os campos da
 * escolhida e limpa os das outras na hora, para o form não montar uma quarta.
 */
export default function PagamentoForm({
  defaultValues,
  obraOptions,
  notas,
  acordos,
  parcelas,
  submitLabel,
  cancelHref,
  onSubmit,
}: PagamentoFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<PagamentoFormValues>({ resolver: zodResolver(pagamentoSchema), defaultValues })

  const obraId = watch('obra_id')
  const origem = watch('origem')
  const notaId = watch('nota_id')
  const acordoId = watch('acordo_id')
  const parcelaId = watch('parcela_acordo_id')
  const valor = Number(watch('valor'))

  // FKs compostas: NF e parcela têm de ser da mesma obra do pagamento.
  const notasDaObra = notas.filter((n) => n.obra_id === obraId)
  const acordosDaObra = acordos.filter((a) => a.obra_id === obraId)
  const parcelasDoAcordo = parcelas.filter((p) => p.acordo_id === acordoId)

  const notaEscolhida = origem === 'nf' ? notas.find((n) => n.id === notaId) : undefined
  const parcelaEscolhida = origem === 'acordo' ? parcelas.find((p) => p.id === parcelaId) : undefined
  const saldo = notaEscolhida?.saldo ?? parcelaEscolhida?.saldo ?? null
  const aviso = avisoDeExcesso(valor, saldo, notaEscolhida ? 'nota fiscal' : 'parcela')

  function trocarObra(nova: string) {
    setValue('obra_id', nova, { shouldValidate: true })
    // NF, acordo e parcela eram da obra antiga.
    setValue('nota_id', '')
    setValue('acordo_id', '')
    setValue('parcela_acordo_id', '')
  }

  function trocarOrigem(nova: PagamentoOrigem) {
    setValue('origem', nova)
    // Uma combinação por vez: o vínculo das outras origens sai na hora.
    if (nova !== 'nf') setValue('nota_id', '')
    if (nova !== 'acordo') {
      setValue('acordo_id', '')
      setValue('parcela_acordo_id', '')
    }
  }

  const obraRegistro = register('obra_id')
  const acordoRegistro = register('acordo_id')

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="max-w-3xl mx-auto bg-white rounded-lg border border-gray-200 shadow-sm p-4 md:p-8 space-y-8"
      noValidate
    >
      <FormSection title="Origem">
        <FormField label="Obra" htmlFor="obra_id" required error={errors.obra_id?.message} className="md:col-span-2">
          <Select
            id="obra_id"
            options={obraOptions}
            placeholder="Selecione a obra"
            disabled={isSubmitting}
            {...obraRegistro}
            onChange={(e) => trocarObra(e.target.value)}
          />
        </FormField>
        <fieldset className="md:col-span-2" aria-label="Origem">
          <div className="flex flex-wrap gap-4">
            {ORIGEM_PAGAMENTO_OPTIONS.map((o) => (
              <label key={o.value} className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="radio"
                  name="origem"
                  value={o.value}
                  checked={origem === o.value}
                  disabled={isSubmitting}
                  onChange={() => trocarOrigem(o.value)}
                />
                {o.label}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-500">{ORIGEM_DICA[origem as PagamentoOrigem] ?? ''}</p>
        </fieldset>

        {origem === 'nf' && (
          <FormField label="Nota fiscal" htmlFor="nota_id" required error={errors.nota_id?.message} className="md:col-span-2" hint="Canceladas não aparecem: não recebem pagamento.">
            <Select
              id="nota_id"
              options={notasDaObra.map((n) => ({ value: n.id, label: n.label }))}
              placeholder={!obraId ? 'Selecione a obra primeiro' : notasDaObra.length ? 'Selecione a nota fiscal' : 'A obra não tem nota fiscal em aberto'}
              disabled={isSubmitting || !obraId}
              {...register('nota_id')}
            />
          </FormField>
        )}

        {origem === 'acordo' && (
          <>
            <FormField label="Acordo" htmlFor="acordo_id" required error={errors.acordo_id?.message}>
              <Select
                id="acordo_id"
                options={acordosDaObra.map((a) => ({ value: a.id, label: a.label }))}
                placeholder={!obraId ? 'Selecione a obra primeiro' : acordosDaObra.length ? 'Selecione o acordo' : 'A obra não tem acordo aberto'}
                disabled={isSubmitting || !obraId}
                {...acordoRegistro}
                onChange={(e) => {
                  setValue('acordo_id', e.target.value, { shouldValidate: true })
                  setValue('parcela_acordo_id', '')
                }}
              />
            </FormField>
            <FormField label="Parcela" htmlFor="parcela_acordo_id" required error={errors.parcela_acordo_id?.message}>
              <Select
                id="parcela_acordo_id"
                options={parcelasDoAcordo.map((p) => ({ value: p.id, label: p.label }))}
                placeholder={!acordoId ? 'Selecione o acordo primeiro' : parcelasDoAcordo.length ? 'Selecione a parcela' : 'O acordo não tem parcela em aberto'}
                disabled={isSubmitting || !acordoId}
                {...register('parcela_acordo_id')}
              />
            </FormField>
          </>
        )}

        {saldo != null && (
          <p className="md:col-span-2 text-sm text-gray-600" aria-live="polite">
            {`Saldo em aberto: ${formatCurrency(saldo)}`}
          </p>
        )}
      </FormSection>

      <FormSection title="Pagamento">
        <FormField label="Data do pagamento" htmlFor="data_pagamento" required error={errors.data_pagamento?.message}>
          <Input id="data_pagamento" type="date" disabled={isSubmitting} {...register('data_pagamento')} />
        </FormField>
        <FormField label="Valor (R$)" htmlFor="valor" required error={errors.valor?.message}>
          <Input id="valor" type="number" inputMode="decimal" step="0.01" min="0.01" disabled={isSubmitting} {...register('valor')} />
        </FormField>
        <FormField label="Forma" htmlFor="forma" required error={errors.forma?.message}>
          <Select id="forma" options={FORMA_PAGAMENTO_OPTIONS} placeholder="Selecione a forma" disabled={isSubmitting} {...register('forma')} />
        </FormField>
        {aviso && (
          <div
            role="status"
            className="md:col-span-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{`${aviso} O pagamento pode ser salvo assim mesmo.`}</span>
          </div>
        )}
      </FormSection>

      <FormSection title="Observações">
        <FormField
          label="Observação"
          htmlFor="observacao"
          required={origem === 'avulso'}
          hint={origem === 'avulso' ? 'Obrigatória no avulso: do que é o dinheiro.' : undefined}
          error={errors.observacao?.message}
          className="md:col-span-2"
        >
          <Textarea id="observacao" rows={3} disabled={isSubmitting} {...register('observacao')} />
        </FormField>
      </FormSection>

      <section className="space-y-2">
        <header className="pb-2 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900">Comprovante</h2>
        </header>
        <p className="text-sm text-gray-500">O comprovante é anexado depois de registrar o pagamento.</p>
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
