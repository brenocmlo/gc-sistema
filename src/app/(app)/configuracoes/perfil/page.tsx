import { redirect } from 'next/navigation'

import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'
import { PERFIL_LABELS } from '@/lib/types'
import { PERFIL_DESCRICOES } from '@/lib/usuarios'

import MeuPerfilPanel from './meu-perfil-panel'

/** Meu perfil (s14): todos os perfis. Cada um edita a própria linha; o resto é do admin. */
export default async function MeuPerfilPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')

  const supabase = createClient()
  const { data: eu } = await supabase
    .from('profiles')
    .select('nome, email, telefone, perfil')
    .eq('id', profile.id)
    .maybeSingle()

  if (!eu) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700">
        Perfil não encontrado. Avise o administrador.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-xl font-semibold text-gray-900">Meu perfil</h1>
        <p className="text-sm text-gray-500 mt-1">
          Seus dados de acesso. Para mudar o e-mail ou o perfil, fale com o administrador.
        </p>
      </div>

      <div className="max-w-3xl mx-auto bg-white border border-gray-200 rounded-lg p-4 md:p-6">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-gray-500">E-mail (login)</dt>
            <dd className="text-gray-900 font-medium break-all">{eu.email}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Perfil</dt>
            <dd className="text-gray-900 font-medium">{PERFIL_LABELS[profile.perfil]}</dd>
            <dd className="text-xs text-gray-500 mt-0.5">{PERFIL_DESCRICOES[profile.perfil]}</dd>
          </div>
        </dl>
      </div>

      <MeuPerfilPanel nome={eu.nome} telefone={eu.telefone ?? ''} />
    </div>
  )
}
