'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import Image from 'next/image'
import { useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'

import FormField from '@/components/form/FormField'
import FormSection from '@/components/form/FormSection'
import Input from '@/components/form/Input'
import { formatPhoneMask } from '@/lib/phone'

import { updateEmpresa, uploadLogo } from './actions'
import {
  empresaSchema,
  formValuesToPayload,
  type EmpresaFormValues,
} from './empresa-form-helpers'

type EmpresaFormProps = {
  defaultValues: EmpresaFormValues
  initialLogoUrl: string | null
}

export default function EmpresaForm({
  defaultValues,
  initialLogoUrl,
}: EmpresaFormProps) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<EmpresaFormValues>({
    resolver: zodResolver(empresaSchema),
    defaultValues,
  })

  const [logoUrl, setLogoUrl] = useState(initialLogoUrl)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleSubmit_(values: EmpresaFormValues) {
    const result = await updateEmpresa(formValuesToPayload(values))
    if (!result.ok) {
      toast.error(`Não foi possível salvar: ${result.error}`)
      return
    }
    toast.success('Empresa atualizada')
  }

  async function handleLogoChange(file: File) {
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    const result = await uploadLogo(fd)
    setUploading(false)

    if (!result.ok) {
      toast.error(`Não foi possível enviar o logo: ${result.error}`)
      return
    }
    setLogoUrl(result.url)
    toast.success('Logo atualizado')
  }

  return (
    <form
      onSubmit={handleSubmit(handleSubmit_)}
      className="max-w-3xl mx-auto bg-white rounded-lg border border-gray-200 shadow-sm p-8 space-y-8"
      noValidate
    >
      <FormSection title="Logo">
        <div className="md:col-span-2 flex items-center gap-6">
          <div className="w-32 h-32 bg-gray-50 border border-gray-200 rounded-md flex items-center justify-center overflow-hidden shrink-0">
            {logoUrl ? (
              // unoptimized: URL signed do Storage não vai pelo loader do Next
              <Image
                src={logoUrl}
                alt="Logo da empresa"
                width={128}
                height={128}
                unoptimized
                className="object-contain w-full h-full"
              />
            ) : (
              <span className="text-xs text-gray-400 text-center px-2">
                Sem logo
              </span>
            )}
          </div>

          <div className="flex-1 space-y-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {uploading ? 'Enviando...' : logoUrl ? 'Trocar logo' : 'Enviar logo'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleLogoChange(f)
                e.target.value = ''
              }}
            />
            <p className="text-xs text-gray-500">
              PNG, JPG, WEBP ou SVG. Máximo 2MB. Será usado no cabeçalho dos
              relatórios PDF.
            </p>
          </div>
        </div>
      </FormSection>

      <FormSection title="Identificação">
        <FormField
          label="Nome (interno)"
          htmlFor="nome"
          required
          hint="Como você se refere à empresa no dia a dia"
          error={errors.nome?.message}
        >
          <Input id="nome" type="text" disabled={isSubmitting} {...register('nome')} />
        </FormField>

        <FormField
          label="Razão social"
          htmlFor="razao_social"
          required
          hint="Como aparece em NFs e documentos formais"
          error={errors.razao_social?.message}
        >
          <Input
            id="razao_social"
            type="text"
            disabled={isSubmitting}
            {...register('razao_social')}
          />
        </FormField>

        <FormField
          label="CNPJ"
          htmlFor="cnpj"
          hint="Aceita caracteres alfanuméricos, sem máscara"
          error={errors.cnpj?.message}
        >
          <Input id="cnpj" type="text" disabled={isSubmitting} {...register('cnpj')} />
        </FormField>
      </FormSection>

      <FormSection title="Contato">
        <FormField label="Email" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" disabled={isSubmitting} {...register('email')} />
        </FormField>

        <FormField
          label="Telefone"
          htmlFor="telefone"
          error={errors.telefone?.message}
        >
          <Controller
            name="telefone"
            control={control}
            render={({ field }) => (
              <Input
                id="telefone"
                type="tel"
                placeholder="(00) 00000-0000"
                disabled={isSubmitting}
                value={field.value ?? ''}
                onChange={(e) => field.onChange(formatPhoneMask(e.target.value))}
                onBlur={field.onBlur}
                ref={field.ref}
              />
            )}
          />
        </FormField>
      </FormSection>

      <FormSection title="Endereço">
        <FormField
          label="Endereço"
          htmlFor="endereco"
          error={errors.endereco?.message}
          className="md:col-span-2"
        >
          <Input
            id="endereco"
            type="text"
            disabled={isSubmitting}
            {...register('endereco')}
          />
        </FormField>

        <FormField label="Cidade" htmlFor="cidade" error={errors.cidade?.message}>
          <Input id="cidade" type="text" disabled={isSubmitting} {...register('cidade')} />
        </FormField>

        <FormField label="CEP" htmlFor="cep" error={errors.cep?.message}>
          <Input
            id="cep"
            type="text"
            placeholder="00000-000"
            disabled={isSubmitting}
            {...register('cep')}
          />
        </FormField>
      </FormSection>

      <FormSection title="Inscrições fiscais">
        <FormField
          label="Inscrição estadual"
          htmlFor="inscricao_estadual"
          error={errors.inscricao_estadual?.message}
        >
          <Input
            id="inscricao_estadual"
            type="text"
            disabled={isSubmitting}
            {...register('inscricao_estadual')}
          />
        </FormField>

        <FormField
          label="Inscrição municipal"
          htmlFor="inscricao_municipal"
          error={errors.inscricao_municipal?.message}
        >
          <Input
            id="inscricao_municipal"
            type="text"
            disabled={isSubmitting}
            {...register('inscricao_municipal')}
          />
        </FormField>
      </FormSection>

      <div className="flex items-center justify-end pt-4 border-t border-gray-200">
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-4 py-2 rounded-md bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Salvando...' : 'Salvar alterações'}
        </button>
      </div>
    </form>
  )
}
