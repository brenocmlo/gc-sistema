'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'

import { createClient } from '@/lib/supabase/client'
import { SENHA_MIN, senhaSchema, type SenhaFormValues } from '@/lib/usuarios'

type Props = { nome: string; email: string; convite: boolean }

export default function DefinirSenha({ nome, email, convite }: Props) {
  const router = useRouter()
  const [erro, setErro] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SenhaFormValues>({ resolver: zodResolver(senhaSchema), defaultValues: { senha: '', confirmacao: '' } })

  async function salvar(values: SenhaFormValues) {
    setErro(null)
    const { error } = await createClient().auth.updateUser({ password: values.senha })
    if (error) {
      setErro(/different from the old/i.test(error.message) ? 'A nova senha precisa ser diferente da anterior' : error.message)
      return
    }
    router.replace('/')
    router.refresh()
  }

  const campo = 'w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent'
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow-sm border border-gray-200 p-8">
        <div className="flex flex-col items-center mb-6 text-center">
          <div aria-hidden className="w-12 h-12 rounded-md bg-gray-900 mb-4" />
          <h1 className="text-2xl font-semibold text-gray-900">{convite ? `Bem-vindo, ${nome}` : 'Definir nova senha'}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {convite ? 'Crie sua senha para entrar no Gestão de Contratos.' : 'Escolha uma nova senha para a sua conta.'} Seu login é <strong className="text-gray-700">{email}</strong>.
          </p>
        </div>
        <form onSubmit={handleSubmit(salvar)} className="space-y-4" noValidate>
          <div>
            <label htmlFor="senha" className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
            <input id="senha" type="password" autoComplete="new-password" className={campo} disabled={isSubmitting} aria-describedby="senha-ajuda" {...register('senha')} />
            <p id="senha-ajuda" className="text-xs text-gray-500 mt-1">Ao menos {SENHA_MIN} caracteres.</p>
            {errors.senha && <p className="text-sm text-red-600 mt-1">{errors.senha.message}</p>}
          </div>
          <div>
            <label htmlFor="confirmacao" className="block text-sm font-medium text-gray-700 mb-1">Confirme a senha</label>
            <input id="confirmacao" type="password" autoComplete="new-password" className={campo} disabled={isSubmitting} {...register('confirmacao')} />
            {errors.confirmacao && <p className="text-sm text-red-600 mt-1">{errors.confirmacao.message}</p>}
          </div>
          {erro && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{erro}</p>}
          <button type="submit" disabled={isSubmitting} className="w-full py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-800 disabled:opacity-60">
            {isSubmitting ? 'Salvando…' : convite ? 'Criar senha e entrar' : 'Salvar senha e entrar'}
          </button>
        </form>
      </div>
    </main>
  )
}
