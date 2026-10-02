'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Trash2, Wand2 } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'

import FormField from '@/components/form/FormField'
import FormSection from '@/components/form/FormSection'
import Input from '@/components/form/Input'
import Select from '@/components/form/Select'
import Textarea from '@/components/form/Textarea'
import { MOTIVO_ACORDO_OPTIONS } from '@/lib/acordos'
import {
  acordoSchema,
  gerarParcelas,
  PERIODICIDADE_LABELS,
  PERIODICIDADES,
  somarPeriodos,
  totalDasParcelas,
  VINCULOS_ACORDO,
  type AcordoFormValues,
  type Periodicidade,
} from '@/lib/acordos-form'
import { formatCurrency } from '@/lib/format'

import type { VinculoOpcao } from '../notas-fiscais/nota-fiscal-form'

const VINCULO_LABELS: Record<(typeof VINCULOS_ACORDO)[number], string> = {
  nenhum: 'Sem vínculo',
  contrato: 'Contrato',
  proposta: 'Proposta',
}

const PERIODICIDADE_OPTIONS = PERIODICIDADES.map((p) => ({ value: p, label: PERIODICIDADE_LABELS[p] }))

type AcordoFormProps = {
  defaultValues: AcordoFormValues
  obraOptions: readonly { value: string; label: string }[]
  contratos: readonly VinculoOpcao[]
  propostas: readonly VinculoOpcao[]
  submitLabel: string
  cancelHref: string
  onSubmit: (values: AcordoFormValues) => Promise<void>
}

/**
 * Formulário do acordo (11.2): os dados do acordo, o vínculo XOR opcional e as
 * parcelas. O gerador monta as parcelas a partir do total, da quantidade, do
 * primeiro vencimento e da periodicidade (a última leva a sobra dos
 * centavos); a prévia é editável linha a linha antes de salvar.
 */
export default function AcordoForm({
  defaultValues,
  obraOptions,
  contratos,
  propostas,
  submitLabel,
  cancelHref,
  onSubmit,
}: AcordoFormProps) {
  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<AcordoFormValues>({ resolver: zodResolver(acordoSchema), defaultValues })
  const { fields, replace, append, remove } = useFieldArray({ control, name: 'parcelas' })

  // O gerador não é gravado: só monta a lista de parcelas.
  const [gerador, setGerador] = useState({
    valorTotal: '',
    quantidade: '',
    primeiroVencimento: defaultValues.data_abertura,
    periodicidade: 'mensal' as Periodicidade,
  })
  const [erroGerador, setErroGerador] = useState<string | null>(null)

  const obraId = watch('obra_id')
  const vinculo = watch('vinculo')
  const parcelas = watch('parcelas') ?? []
  const total = totalDasParcelas(parcelas.map((p) => ({ valor_previsto: Number(p.valor_previsto) || 0 })))
  const totalInformado = Number(gerador.valorTotal)
  const diferenca = Number.isFinite(totalInformado) && totalInformado > 0 && parcelas.length > 0
    ? Math.round(total * 100) - Math.round(totalInformado * 100)
    : 0

  // FKs compostas: contrato e proposta da mesma obra do acordo.
  const contratosDaObra = contratos.filter((c) => c.obra_id === obraId).map((c) => ({ value: c.id, label: c.label }))
  const propostasDaObra = propostas.filter((p) => p.obra_id === obraId).map((p) => ({ value: p.id, label: p.label }))

  function trocarObra(nova: string) {
    setValue('obra_id', nova, { shouldValidate: true })
    setValue('contrato_id', '')
    setValue('proposta_id', '')
  }

  function trocarVinculo(novo: AcordoFormValues['vinculo']) {
    setValue('vinculo', novo)
    // Contrato OU proposta, nunca os dois: o outro é limpo na hora.
    if (novo !== 'contrato') setValue('contrato_id', '')
    if (novo !== 'proposta') setValue('proposta_id', '')
  }

  function gerar() {
    const r = gerarParcelas({
      valorTotal: Number(gerador.valorTotal),
      quantidade: Number(gerador.quantidade),
      primeiroVencimento: gerador.primeiroVencimento,
      periodicidade: gerador.periodicidade,
    })
    if (!r.ok) return setErroGerador(r.error)
    setErroGerador(null)
    replace(r.parcelas.map((p) => ({ ...p, observacao: '' })))
  }

  function adicionarParcela() {
    // A próxima, um período depois da última (ou no primeiro vencimento do gerador).
    const ultima = parcelas[parcelas.length - 1]
    const data = ultima?.data_vencimento
      ? somarPeriodos(ultima.data_vencimento, gerador.periodicidade, 1)
      : gerador.primeiroVencimento
    append({ data_vencimento: data, valor_previsto: '' as unknown as number, observacao: '' })
  }

  const obraRegistro = register('obra_id')

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="max-w-4xl mx-auto bg-white rounded-lg border border-gray-200 shadow-sm p-4 md:p-8 space-y-8"
      noValidate
    >
      <FormSection title="Acordo">
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
        <FormField label="Descrição" htmlFor="descricao" required error={errors.descricao?.message} className="md:col-span-2" hint='O assunto, por exemplo "Sinal outubro"'>
          <Input id="descricao" type="text" disabled={isSubmitting} {...register('descricao')} />
        </FormField>
        <FormField label="Motivo" htmlFor="motivo" error={errors.motivo?.message}>
          <Select id="motivo" options={MOTIVO_ACORDO_OPTIONS} placeholder="Sem motivo" disabled={isSubmitting} {...register('motivo')} />
        </FormField>
        <FormField label="Período de referência" htmlFor="periodo_ref" error={errors.periodo_ref?.message} hint='Livre, para agrupar: "Outubro/2026"'>
          <Input id="periodo_ref" type="text" disabled={isSubmitting} {...register('periodo_ref')} />
        </FormField>
        <FormField label="Abertura" htmlFor="data_abertura" required error={errors.data_abertura?.message}>
          <Input id="data_abertura" type="date" disabled={isSubmitting} {...register('data_abertura')} />
        </FormField>
      </FormSection>

      <FormSection title="Vínculo" description="Opcional: o acordo pode ser de um contrato OU de uma proposta, nunca dos dois.">
        <fieldset className="md:col-span-2" aria-label="Vínculo">
          <div className="flex flex-wrap gap-4">
            {VINCULOS_ACORDO.map((v) => (
              <label key={v} className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input type="radio" name="vinculo" value={v} checked={vinculo === v} disabled={isSubmitting} onChange={() => trocarVinculo(v)} />
                {VINCULO_LABELS[v]}
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

      <section className="space-y-4" aria-label="Parcelas">
        <header className="pb-2 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900">Parcelas</h2>
          <p className="text-xs text-gray-500 mt-1">
            Gere as parcelas e ajuste linha a linha. Se o total não dividir em centavos iguais, a última parcela leva a sobra.
          </p>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end rounded-md border border-gray-200 bg-gray-50 p-3" data-gerador>
          <FormField label="Valor total (R$)" htmlFor="ger_total">
            <Input id="ger_total" type="number" inputMode="decimal" step="0.01" min="0.01" value={gerador.valorTotal}
              onChange={(e) => setGerador((g) => ({ ...g, valorTotal: e.target.value }))} disabled={isSubmitting} />
          </FormField>
          <FormField label="Nº de parcelas" htmlFor="ger_qtd">
            <Input id="ger_qtd" type="number" inputMode="numeric" step="1" min="1" max="120" value={gerador.quantidade}
              onChange={(e) => setGerador((g) => ({ ...g, quantidade: e.target.value }))} disabled={isSubmitting} />
          </FormField>
          <FormField label="1º vencimento" htmlFor="ger_venc">
            <Input id="ger_venc" type="date" value={gerador.primeiroVencimento}
              onChange={(e) => setGerador((g) => ({ ...g, primeiroVencimento: e.target.value }))} disabled={isSubmitting} />
          </FormField>
          <FormField label="Periodicidade" htmlFor="ger_per">
            <Select id="ger_per" options={PERIODICIDADE_OPTIONS} value={gerador.periodicidade}
              onChange={(e) => setGerador((g) => ({ ...g, periodicidade: e.target.value as Periodicidade }))} disabled={isSubmitting} />
          </FormField>
          <button
            type="button"
            onClick={gerar}
            disabled={isSubmitting}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:bg-gray-400"
          >
            <Wand2 size={14} />
            {fields.length > 0 ? 'Gerar de novo' : 'Gerar parcelas'}
          </button>
        </div>
        {erroGerador && <p role="alert" className="text-sm text-red-700">{erroGerador}</p>}

        {fields.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-gray-200">
            <table className="w-full text-sm" aria-label="Prévia das parcelas">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-700 w-12">Nº</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Vencimento</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Valor (R$)</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Observação</th>
                  <th className="px-3 py-2" aria-label="Ações" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {fields.map((field, i) => (
                  <tr key={field.id} data-parcela={i + 1}>
                    <td className="px-3 py-2 tabular-nums text-gray-600">{i + 1}</td>
                    <td className="px-3 py-2">
                      <Input type="date" aria-label={`Vencimento da parcela ${i + 1}`} disabled={isSubmitting} {...register(`parcelas.${i}.data_vencimento`)} />
                      {errors.parcelas?.[i]?.data_vencimento && <p className="text-xs text-red-700 mt-1">{errors.parcelas[i]?.data_vencimento?.message}</p>}
                    </td>
                    <td className="px-3 py-2">
                      <Input type="number" inputMode="decimal" step="0.01" min="0.01" aria-label={`Valor da parcela ${i + 1}`} disabled={isSubmitting} {...register(`parcelas.${i}.valor_previsto`)} />
                      {errors.parcelas?.[i]?.valor_previsto && <p className="text-xs text-red-700 mt-1">{errors.parcelas[i]?.valor_previsto?.message}</p>}
                    </td>
                    <td className="px-3 py-2">
                      <Input type="text" aria-label={`Observação da parcela ${i + 1}`} disabled={isSubmitting} {...register(`parcelas.${i}.observacao`)} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" onClick={() => remove(i)} disabled={isSubmitting} aria-label={`Remover a parcela ${i + 1}`}
                        className="text-gray-400 hover:text-red-600 disabled:opacity-50">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 border-t border-gray-200">
                <tr>
                  <td className="px-3 py-2 font-medium text-gray-700" colSpan={2}>
                    {`Total em ${fields.length} ${fields.length === 1 ? 'parcela' : 'parcelas'}`}
                  </td>
                  <td className="px-3 py-2 font-semibold text-gray-900 tabular-nums" colSpan={3}>
                    {formatCurrency(total)}
                    {diferenca !== 0 && (
                      <span className="ml-2 text-xs font-medium text-amber-700">
                        {`${diferenca > 0 ? 'passa' : 'fica abaixo'} do valor total informado em ${formatCurrency(Math.abs(diferenca) / 100)}`}
                      </span>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <div className="flex items-center gap-3">
          <button type="button" onClick={adicionarParcela} disabled={isSubmitting}
            className="inline-flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-gray-900 disabled:opacity-50">
            <Plus size={14} />
            Adicionar parcela
          </button>
          {errors.parcelas?.message && <p role="alert" className="text-sm text-red-700">{errors.parcelas.message}</p>}
          {errors.parcelas?.root?.message && <p role="alert" className="text-sm text-red-700">{errors.parcelas.root.message}</p>}
        </div>
      </section>

      <FormSection title="Observações">
        <FormField label="Observações" htmlFor="observacao" error={errors.observacao?.message} className="md:col-span-2">
          <Textarea id="observacao" rows={3} disabled={isSubmitting} {...register('observacao')} />
        </FormField>
      </FormSection>

      <section className="space-y-2">
        <header className="pb-2 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900">Anexos</h2>
        </header>
        <p className="text-sm text-gray-500">A conversa do WhatsApp ou o documento assinado entram pela aba &ldquo;Anexos&rdquo; do acordo.</p>
      </section>

      <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
        <Link href={cancelHref} className="px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
          Cancelar
        </Link>
        <button type="submit" disabled={isSubmitting}
          className="px-4 py-2 rounded-md bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed">
          {isSubmitting ? 'Salvando...' : submitLabel}
        </button>
      </div>
    </form>
  )
}
