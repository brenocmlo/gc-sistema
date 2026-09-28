import { redirect } from 'next/navigation'
import { Toaster } from 'sonner'

import AppShell from '@/components/AppShell'
import { getCurrentProfile } from '@/lib/supabase/profile'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const profile = await getCurrentProfile()

  // Rede de segurança — middleware já redireciona anônimos, mas se algo escapar:
  if (profile === null) {
    const {
      createClient,
    } = await import('@/lib/supabase/server')
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) redirect('/login')

    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md text-center bg-white border border-gray-200 rounded-lg shadow-sm p-8">
          <h1 className="text-xl font-semibold text-gray-900 mb-2">
            Perfil não configurado
          </h1>
          <p className="text-gray-600 text-sm">
            Seu perfil não foi configurado. Fale com o admin.
          </p>
        </div>
      </main>
    )
  }

  return (
    <>
      <AppShell
        user={{
          nome: profile.nome,
          email: profile.email,
          perfil: profile.perfil,
        }}
      >
        {children}
      </AppShell>
      <Toaster position="top-right" richColors closeButton />
    </>
  )
}
