'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import Link from 'next/link'
import { useForm } from 'react-hook-form'

import FormField from '@/components/form/FormField'
import FormSection from '@/components/form/FormSection'
import Input from '@/components/form/Input'
import Select from '@/components/form/Select'
import Textarea from '@/components/form/Textarea'
import { TIPO_NF_OPTIONS } from '@/lib/notas-fiscais'
import {
  notaFiscalSchema,
  VINCULO_NF_LABELS,
  VINCULOS_NF,
  type NotaFiscalFormValues,
} from '@/lib/notas-fiscais-form'

/** Contrato ou proposta que pode ser o vínculo: o select mostra só os da obra escolhida. */
export type VinculoOpcao = { id: string; obra_id: string; label: string }

type NotaFiscalFormProps = {
  defaultValues: NotaFiscalFormValues
  obraOptions: readonly { value: string; label: string }[]
  contratos: readonly VinculoOpcao[]
  propostas: readonly VinculoOpcao[]
  submitLabel: string
  cancelHref: string
  onSubmit: (values: NotaFiscalFormValues) => Promise<void>
}

/** Formulário de NF (9.2), usado também pela edição (9.3). */
export default function NotaFiscalForm({
  defaultValues,
  obraOptions,
  contratos,
  propostas,
  submitLabel,
  cancelHref,
  onSubmit,
}: NotaFiscalFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<NotaFiscalFormValues>({ resolver: zodResolver(notaFiscalSchema), defaultValues })

  const obraId = watch('obra_id')
  const vinculo = watch('vinculo')
  // FK composta: o contrato e a proposta têm de ser da mesma obra da NF.
  const contratosDaObra = contratos.filter((c) => c.obra_id === obraId).map((c) => ({ value: c.id, label: c.label }))
  const propostasDaObra = propostas.filter((p) => p.obra_id === obraId).map((p) => ({ value: p.id, label: p.label }))

  function trocarObra(novaObra: string) {
    setValue('obra_id', novaObra, { shouldValidate: true })
    // O vínculo escolhido era da obra antiga.
    setValue('contrato_id', '')
    setValue('proposta_id', '')
  }

  function trocarVinculo(novo: NotaFiscalFormValues['vinculo']) {
    setValue('vinculo', novo)
    // Contrato OU proposta, nunca os dois: o outro é limpo na hora.
    if (novo !== 'contrato') setValue('contrato_id', '')
    if (novo !== 'proposta') setValue('proposta_id', '')
  }

  const obraRegistro = register('obra_id')

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="max-w-3xl mx-auto bg-white rounded-lg border border-gray-200 shadow-sm p-4 md:p-8 space-y-8"
      noValidate
    >
      <FormSection title="Identificação">
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
        <FormField label="Número" htmlFor="numero" required error={errors.numero?.message}>
          <Input id="numero" type="text" placeholder="000123" disabled={isSubmitting} {...register('numero')} />
        </FormField>
        <FormField label="Série" htmlFor="serie" hint="Número e série são únicos por empresa" error={errors.serie?.message}>
          <Input id="serie" type="text" placeholder="1" disabled={isSubmitting} {...register('serie')} />
        </FormField>
        <FormField
          label="Chave da NF-e"
          htmlFor="chave_nfe"
          hint="44 dígitos; opcional. Não se repete entre notas."
          error={errors.chave_nfe?.message}
          className="md:col-span-2"
        >
          <Input id="chave_nfe" type="text" inputMode="numeric" disabled={isSubmitting} {...register('chave_nfe')} />
        </FormField>
      </FormSection>

      <FormSection title="Vínculo" description="A nota fiscal é de um contrato OU de uma proposta, nunca dos dois.">
        <fieldset className="md:col-span-2" aria-label="Vínculo">
          <div className="flex flex-wrap gap-4">
            {VINCULOS_NF.map((v) => (
              <label key={v} className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="radio"
                  name="vinculo"
                  value={v}
                  checked={vinculo === v}
                  disabled={isSubmitting}
                  onChange={() => trocarVinculo(v)}
                />
                {VINCULO_NF_LABELS[v]}
              </label>
            ))}
          </div>
        </fieldset>
        {vinculo === 'contrato' && (
          <FormField label="Contrato" htmlFor="contrato_id" required error={errors.contrato_id?.message} className="md:col-span-2">
            <Select
              id="contrato_id"
              options={contratosDaObra}
              placeholder={!obraId ? 'Selecione a obra primeiro' : contratosDaObra.length ? 'Selecione o contrato' : 'A obra não tem contrato'}
              disabled={isSubmitting || !obraId}
              {...register('contrato_id')}
            />
          </FormField>
        )}
        {vinculo === 'proposta' && (
          <FormField label="Proposta" htmlFor="proposta_id" required error={errors.proposta_id?.message} className="md:col-span-2">
            <Select
              id="proposta_id"
              options={propostasDaObra}
              placeholder={!obraId ? 'Selecione a obra primeiro' : propostasDaObra.length ? 'Selecione a proposta' : 'A obra não tem proposta'}
              disabled={isSubmitting || !obraId}
              {...register('proposta_id')}
            />
          </FormField>
        )}
      </FormSection>

      <FormSection title="Tipo, datas e valor">
        <FormField label="Tipo" htmlFor="tipo" required error={errors.tipo?.message}>
          <Select id="tipo" options={TIPO_NF_OPTIONS} placeholder="Selecione o tipo" disabled={isSubmitting} {...register('tipo')} />
        </FormField>
        <FormField label="Valor total (R$)" htmlFor="valor_total" required error={errors.valor_total?.message}>
          <Input id="valor_total" type="number" inputMode="decimal" step="0.01" min="0.01" disabled={isSubmitting} {...register('valor_total')} />
        </FormField>
        <FormField label="Emissão" htmlFor="data_emissao" required error={errors.data_emissao?.message}>
          <Input id="data_emissao" type="date" disabled={isSubmitting} {...register('data_emissao')} />
        </FormField>
        <FormField label="Vencimento" htmlFor="data_vencimento" error={errors.data_vencimento?.message}>
          <Input id="data_vencimento" type="date" disabled={isSubmitting} {...register('data_vencimento')} />
        </FormField>
      </FormSection>

      <FormSection title="Observações">
        <FormField label="Observações" htmlFor="observacao" error={errors.observacao?.message} className="md:col-span-2">
          <Textarea id="observacao" rows={3} disabled={isSubmitting} {...register('observacao')} />
        </FormField>
      </FormSection>

      <section className="space-y-2">
        <header className="pb-2 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900">Arquivos</h2>
        </header>
        <p className="text-sm text-gray-500">O XML e o PDF da nota entram pela aba &ldquo;Arquivos&rdquo; do detalhe.</p>
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
