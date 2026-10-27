'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'

import FormField from '@/components/form/FormField'
import Input from '@/components/form/Input'
import { formatPhoneMask } from '@/lib/phone'
import {
  meuPerfilSchema,
  SENHA_MIN,
  trocaSenhaSchema,
  type MeuPerfilFormValues,
  type TrocaSenhaFormValues,
} from '@/lib/usuarios'

import { atualizarMeuPerfil, trocarMinhaSenha } from './actions'

type Props = { nome: string; telefone: string }

export default function MeuPerfilPanel({ nome, telefone }: Props) {
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <DadosForm nome={nome} telefone={telefone} />
      <SenhaForm />
    </div>
  )
}

function DadosForm({ nome, telefone }: Props) {
  const router = useRouter()
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<MeuPerfilFormValues>({ resolver: zodResolver(meuPerfilSchema), defaultValues: { nome, telefone } })

  async function salvar(values: MeuPerfilFormValues) {
    const r = await atualizarMeuPerfil(values)
    if (!r.ok) return void toast.error(`Não foi possível salvar: ${r.error}`)
    toast.success('Dados atualizados')
    reset(values)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit(salvar)} noValidate className="bg-white border border-gray-200 rounded-lg p-4 md:p-6 space-y-4">
      <h2 className="text-base font-semibold text-gray-900">Dados pessoais</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Nome" htmlFor="nome" required error={errors.nome?.message}>
          <Input id="nome" autoComplete="name" disabled={isSubmitting} {...register('nome')} />
        </FormField>
        <FormField label="Telefone" htmlFor="telefone" hint="Opcional. O administrador usa para mandar o link de acesso pelo WhatsApp." error={errors.telefone?.message}>
          <Controller
            name="telefone"
            control={control}
            render={({ field }) => (
              <Input id="telefone" inputMode="tel" autoComplete="tel" placeholder="(00) 00000-0000" disabled={isSubmitting} value={field.value ?? ''} onChange={(e) => field.onChange(formatPhoneMask(e.target.value))} onBlur={field.onBlur} />
            )}
          />
        </FormField>
      </div>
      <div className="flex justify-end">
        <button type="submit" disabled={isSubmitting || !isDirty} className="w-full sm:w-auto px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-800 disabled:opacity-60">
          {isSubmitting ? 'Salvando…' : 'Salvar dados'}
        </button>
      </div>
    </form>
  )
}

function SenhaForm() {
  const vazio: TrocaSenhaFormValues = { senhaAtual: '', senha: '', confirmacao: '' }
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<TrocaSenhaFormValues>({ resolver: zodResolver(trocaSenhaSchema), defaultValues: vazio })

  async function salvar(values: TrocaSenhaFormValues) {
    const r = await trocarMinhaSenha(values)
    if (!r.ok) {
      if (r.error === 'Senha atual incorreta') return void setError('senhaAtual', { message: r.error })
      return void toast.error(`Não foi possível trocar a senha: ${r.error}`)
    }
    toast.success('Senha trocada')
    reset(vazio)
  }

  return (
    <form onSubmit={handleSubmit(salvar)} noValidate className="bg-white border border-gray-200 rounded-lg p-4 md:p-6 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Trocar senha</h2>
        <p className="text-sm text-gray-500 mt-1">Esqueceu a atual? Saia e use &quot;Esqueci minha senha&quot; na tela de login.</p>
      </div>
      <FormField label="Senha atual" htmlFor="senhaAtual" required error={errors.senhaAtual?.message}>
        <Input id="senhaAtual" type="password" autoComplete="current-password" disabled={isSubmitting} {...register('senhaAtual')} />
      </FormField>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Nova senha" htmlFor="senha" required hint={`Ao menos ${SENHA_MIN} caracteres.`} error={errors.senha?.message}>
          <Input id="senha" type="password" autoComplete="new-password" disabled={isSubmitting} {...register('senha')} />
        </FormField>
        <FormField label="Confirme a nova senha" htmlFor="confirmacao" required error={errors.confirmacao?.message}>
          <Input id="confirmacao" type="password" autoComplete="new-password" disabled={isSubmitting} {...register('confirmacao')} />
        </FormField>
      </div>
      <div className="flex justify-end">
        <button type="submit" disabled={isSubmitting} className="w-full sm:w-auto px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-800 disabled:opacity-60">
          {isSubmitting ? 'Trocando…' : 'Trocar senha'}
        </button>
      </div>
    </form>
  )
}
