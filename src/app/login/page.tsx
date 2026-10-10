'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/client'

const loginSchema = z.object({
  email: z.string().min(1, 'Email é obrigatório').email('Email inválido'),
  password: z.string().min(8, 'Senha precisa ter pelo menos 8 caracteres'),
})

type LoginForm = z.infer<typeof loginSchema>

const ERROS_DA_URL: Record<string, string> = {
  link: 'O link de acesso é inválido, já foi usado ou venceu. Peça um novo ao administrador.',
  inativo: 'Seu acesso está desativado. Fale com o administrador.',
}

export default function LoginPage() {
  const router = useRouter()
  const [authError, setAuthError] = useState<string | null>(null)

  // Recados de quem chega aqui redirecionado: link de convite vencido ou acesso desativado.
  useEffect(() => {
    const erro = new URLSearchParams(window.location.search).get('erro')
    if (erro && ERROS_DA_URL[erro]) setAuthError(ERROS_DA_URL[erro])
  }, [])

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  })

  async function onSubmit(values: LoginForm) {
    setAuthError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    })

    if (error) {
      setAuthError(
        error.message === 'Invalid login credentials'
          ? 'Email ou senha incorretos'
          : /banned/i.test(error.message) || error.code === 'user_banned'
            ? ERROS_DA_URL.inativo
            : error.message,
      )
      return
    }

    router.push('/')
    router.refresh()
  }

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow-sm border border-gray-200 p-8">
        <div className="flex flex-col items-center mb-6">
          <div
            aria-hidden
            className="w-12 h-12 rounded-md bg-gray-900 mb-4"
          />
          <h1 className="text-2xl font-semibold text-gray-900">
            Gestão de Contratos
          </h1>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              disabled={isSubmitting}
              {...register('email')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
            />
            {errors.email && (
              <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Senha
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              disabled={isSubmitting}
              {...register('password')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
            />
            {errors.password && (
              <p className="mt-1 text-sm text-red-600">
                {errors.password.message}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-gray-900 text-white py-2 rounded-md font-medium hover:bg-gray-800 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Entrando...' : 'Entrar'}
          </button>

          {authError && (
            <p role="alert" className="text-sm text-red-600 text-center">
              {authError}
            </p>
          )}
        </form>

        <div className="mt-6 text-center">
          <Link
            href="/login?reset=true"
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            Esqueci minha senha
          </Link>
        </div>
      </div>
    </main>
  )
}
