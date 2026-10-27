import { redirect } from 'next/navigation'

import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'
import type { Empresa } from '@/lib/types'

import EmpresaForm from './empresa-form'
import { empresaToFormValues } from './empresa-form-helpers'

export default async function ConfiguracoesPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  // O layout só exige sessão (Meu perfil é de todos): o guard de admin é daqui.
  if (profile.perfil !== 'admin') redirect('/')

  const supabase = createClient()

  const { data: empresa } = await supabase
    .from('empresas')
    .select('*')
    .eq('id', profile.empresa_id)
    .maybeSingle()

  if (!empresa) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700">
        Empresa não encontrada. Avise o suporte.
      </div>
    )
  }

  const empresaTyped = empresa as Empresa

  return (
    <div className="space-y-4">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-xl font-semibold text-gray-900">
          Configurações da empresa
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Esses dados aparecem nos relatórios PDF e em documentos formais.
        </p>
      </div>

      <EmpresaForm
        defaultValues={empresaToFormValues(empresaTyped)}
        initialLogoUrl={empresaTyped.logo_url}
      />
    </div>
  )
}
