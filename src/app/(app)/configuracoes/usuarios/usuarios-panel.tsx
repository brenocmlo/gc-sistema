'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { Copy, KeyRound, MessageCircle, Pencil, Power, UserPlus, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'

import ConfirmDialog from '@/components/ConfirmDialog'
import FormField from '@/components/form/FormField'
import Input from '@/components/form/Input'
import Select from '@/components/form/Select'
import Modal from '@/components/Modal'
import { formatDateTime } from '@/lib/format'
import { formatPhoneMask } from '@/lib/phone'
import { PERFIL_LABELS } from '@/lib/types'
import {
  conviteSchema,
  PERFIL_DESCRICOES,
  PERFIL_OPTIONS,
  SITUACAO_USUARIO_LABELS,
  usuarioSchema,
  type ConviteFormValues,
  type SituacaoUsuario,
} from '@/lib/usuarios'

import { atualizarUsuario, convidarUsuario, definirAtivo, gerarLinkDeAcesso } from './actions'
import type { UsuarioListItem } from './page'

type Props = { usuarios: UsuarioListItem[]; erro: string | null; avisoAuth: string | null }

const SELO: Record<SituacaoUsuario, string> = {
  ativo: 'bg-green-100 text-green-700 border-green-200',
  convite_pendente: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  inativo: 'bg-gray-100 text-gray-600 border-gray-200',
}

type Link = { link: string; nome: string; telefone: string | null; tipo: 'convite' | 'acesso' }

/** wa.me só aceita dígitos com o DDI; sem telefone, o WhatsApp abre para escolher o contato. */
function linkWhatsapp(l: Link): string {
  const texto = l.tipo === 'convite'
    ? `Olá, ${l.nome}! Seu acesso ao Gestão de Contratos está pronto. Abra o link para criar sua senha (vale por 1 hora): ${l.link}`
    : `Olá, ${l.nome}! Este é o seu link para entrar no Gestão de Contratos e definir uma nova senha (vale por 1 hora): ${l.link}`
  const digitos = (l.telefone ?? '').replace(/\D/g, '')
  return `https://wa.me/${digitos ? `55${digitos}` : ''}?text=${encodeURIComponent(texto)}`
}

export default function UsuariosPanel({ usuarios, erro, avisoAuth }: Props) {
  const router = useRouter()
  const [editando, setEditando] = useState<UsuarioListItem | 'novo' | null>(null)
  const [link, setLink] = useState<Link | null>(null)
  const [mudandoAtivo, setMudandoAtivo] = useState<UsuarioListItem | null>(null)
  const [gerandoPara, setGerandoPara] = useState<string | null>(null)
  // O mesmo formulário convida (com e-mail) e edita (sem): o schema segue o modo.
  const modoConvite = useRef(true)

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ConviteFormValues>({
    resolver: (values, ctx, opts) =>
      modoConvite.current
        ? zodResolver(conviteSchema)(values, ctx, opts)
        : zodResolver(usuarioSchema)(values, ctx, opts as never) as never,
    defaultValues: { nome: '', email: '', perfil: '', telefone: '' },
  })
  const perfilEscolhido = watch('perfil')

  function abrir(alvo: UsuarioListItem | 'novo') {
    modoConvite.current = alvo === 'novo'
    reset(alvo === 'novo'
      ? { nome: '', email: '', perfil: '', telefone: '' }
      : { nome: alvo.nome, email: alvo.email, perfil: alvo.perfil, telefone: alvo.telefone ?? '' })
    setEditando(alvo)
  }

  async function salvar(values: ConviteFormValues) {
    if (editando === 'novo') {
      const r = await convidarUsuario(values)
      if (!r.ok) return void toast.error(`Não foi possível convidar: ${r.error}`)
      toast.success(`${values.nome} convidado`)
      setEditando(null)
      setLink({ link: r.link, nome: values.nome.trim(), telefone: values.telefone || null, tipo: 'convite' })
    } else if (editando) {
      const r = await atualizarUsuario(editando.id, values)
      if (!r.ok) return void toast.error(`Não foi possível salvar: ${r.error}`)
      toast.success('Usuário atualizado')
      setEditando(null)
    }
    router.refresh()
  }

  async function novoLink(u: UsuarioListItem) {
    setGerandoPara(u.id)
    const r = await gerarLinkDeAcesso(u.id)
    setGerandoPara(null)
    if (!r.ok) return void toast.error(`Não foi possível gerar o link: ${r.error}`)
    setLink({ link: r.link, nome: u.nome, telefone: u.telefone, tipo: u.situacao === 'convite_pendente' ? 'convite' : 'acesso' })
  }

  async function alternarAtivo() {
    if (!mudandoAtivo) return
    const ativar = mudandoAtivo.situacao === 'inativo'
    const r = await definirAtivo(mudandoAtivo.id, ativar)
    if (!r.ok) return void toast.error(r.error)
    toast.success(ativar ? `${mudandoAtivo.nome} reativado` : `${mudandoAtivo.nome} desativado`)
    setMudandoAtivo(null)
    router.refresh()
  }

  async function copiar() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link.link)
      toast.success('Link copiado')
    } catch {
      toast.error('Não foi possível copiar: selecione o link e copie')
    }
  }

  const ativos = usuarios.filter((u) => u.situacao !== 'inativo').length

  return (
    <div className="max-w-5xl mx-auto space-y-3">
      {erro && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{erro}</p>}
      {avisoAuth && (
        <p role="alert" className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          Sem acesso à administração do Auth ({avisoAuth}). A lista aparece, mas último acesso, convite e links não funcionam neste ambiente.
        </p>
      )}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200">
          <span className="text-sm text-gray-600">
            {usuarios.length} {usuarios.length === 1 ? 'usuário' : 'usuários'} · {ativos} com acesso
          </span>
          <button
            type="button"
            onClick={() => abrir('novo')}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-800"
          >
            <UserPlus className="h-4 w-4" aria-hidden />
            Convidar usuário
          </button>
        </div>

        {usuarios.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <Users className="h-8 w-8 text-gray-300 mx-auto" aria-hidden />
            <p className="mt-2 text-sm text-gray-600">Nenhum usuário na empresa.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Usuários da empresa">
              <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-2">Nome</th>
                  <th className="px-4 py-2">Perfil</th>
                  <th className="px-4 py-2">Situação</th>
                  <th className="px-4 py-2 whitespace-nowrap">Último acesso</th>
                  <th className="px-4 py-2 sr-only">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {usuarios.map((u) => (
                  <tr key={u.id} data-usuario={u.email}>
                    <td className="px-4 py-2">
                      <span className="font-medium text-gray-900">{u.nome}</span>
                      {u.euMesmo && <span className="ml-1.5 text-xs text-gray-500">(você)</span>}
                      <span className="block text-xs text-gray-500">{u.email}{u.telefone ? ` · ${u.telefone}` : ''}</span>
                    </td>
                    <td className="px-4 py-2 text-gray-700 whitespace-nowrap">{PERFIL_LABELS[u.perfil]}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex px-2 py-0.5 rounded border text-xs font-medium whitespace-nowrap ${SELO[u.situacao]}`}>
                        {SITUACAO_USUARIO_LABELS[u.situacao]}
                      </span>
                      {u.pedidoDeAcessoEm && (
                        <span
                          className="ml-1.5 inline-flex px-2 py-0.5 rounded border text-xs font-medium whitespace-nowrap bg-amber-50 text-amber-800 border-amber-200"
                          title="Use a chave da linha para gerar o link de acesso e mande à pessoa."
                        >
                          Pediu novo acesso em {formatDateTime(u.pedidoDeAcessoEm)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-600 tabular-nums whitespace-nowrap">{u.ultimoAcesso ? formatDateTime(u.ultimoAcesso) : '—'}</td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-1">
                        <button type="button" onClick={() => abrir(u)} className="p-1.5 text-gray-500 hover:text-gray-900 rounded" aria-label={`Editar ${u.nome}`} title="Editar">
                          <Pencil className="h-4 w-4" />
                        </button>
                        {u.situacao !== 'inativo' && (
                          <button
                            type="button"
                            onClick={() => novoLink(u)}
                            disabled={gerandoPara === u.id}
                            className="p-1.5 text-gray-500 hover:text-gray-900 rounded disabled:opacity-50"
                            aria-label={`Gerar link de acesso para ${u.nome}`}
                            title={u.situacao === 'convite_pendente' ? 'Gerar novo link de convite' : 'Gerar link para definir nova senha'}
                          >
                            <KeyRound className="h-4 w-4" />
                          </button>
                        )}
                        {!u.euMesmo && (
                          <button
                            type="button"
                            onClick={() => setMudandoAtivo(u)}
                            className={`p-1.5 rounded ${u.situacao === 'inativo' ? 'text-gray-500 hover:text-green-700' : 'text-gray-500 hover:text-red-600'}`}
                            aria-label={u.situacao === 'inativo' ? `Reativar ${u.nome}` : `Desativar ${u.nome}`}
                            title={u.situacao === 'inativo' ? 'Reativar' : 'Desativar'}
                          >
                            <Power className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={editando !== null}
        onOpenChange={(open) => !open && setEditando(null)}
        title={editando === 'novo' ? 'Convidar usuário' : 'Editar usuário'}
        dismissible={!isSubmitting}
      >
        <form onSubmit={handleSubmit(salvar)} className="space-y-4" noValidate>
          <FormField label="Nome" htmlFor="nome" required error={errors.nome?.message}>
            <Input id="nome" disabled={isSubmitting} {...register('nome')} />
          </FormField>
          <FormField
            label="E-mail"
            htmlFor="email"
            required={editando === 'novo'}
            hint={editando === 'novo' ? 'É o login da pessoa. Nenhum e-mail é enviado: você recebe um link para mandar.' : 'O e-mail é o login e não muda.'}
            error={errors.email?.message}
          >
            <Input id="email" type="email" autoComplete="off" disabled={isSubmitting || editando !== 'novo'} {...register('email')} />
          </FormField>
          <FormField label="Perfil" htmlFor="perfil" required hint={perfilEscolhido ? PERFIL_DESCRICOES[perfilEscolhido as keyof typeof PERFIL_DESCRICOES] : undefined} error={errors.perfil?.message}>
            <Select id="perfil" placeholder="— Selecione —" options={PERFIL_OPTIONS} disabled={isSubmitting} {...register('perfil')} />
          </FormField>
          <FormField label="Telefone" htmlFor="telefone" hint="Opcional. Com ele, o link abre direto na conversa do WhatsApp." error={errors.telefone?.message}>
            <Controller
              name="telefone"
              control={control}
              render={({ field }) => (
                <Input id="telefone" inputMode="tel" placeholder="(00) 00000-0000" disabled={isSubmitting} value={field.value ?? ''} onChange={(e) => field.onChange(formatPhoneMask(e.target.value))} onBlur={field.onBlur} />
              )}
            />
          </FormField>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setEditando(null)} disabled={isSubmitting} className="px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50">
              Cancelar
            </button>
            <button type="submit" disabled={isSubmitting} className="px-3 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-800 disabled:opacity-60">
              {isSubmitting ? 'Salvando…' : editando === 'novo' ? 'Convidar e gerar link' : 'Salvar'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={link !== null} onOpenChange={(open) => !open && setLink(null)} title={link?.tipo === 'convite' ? 'Link de convite' : 'Link de acesso'}>
        {link && (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              Mande este link para <strong>{link.nome}</strong>. Ao abrir, a pessoa {link.tipo === 'convite' ? 'cria a senha' : 'define uma nova senha'} e já entra no sistema.
              O link vale por <strong>1 hora</strong> e só funciona uma vez; se vencer, gere outro na lista.
            </p>
            <label htmlFor="link-acesso" className="sr-only">Link</label>
            <input id="link-acesso" readOnly value={link.link} onFocus={(e) => e.currentTarget.select()} className="w-full px-3 py-2 text-xs font-mono bg-gray-50 border border-gray-300 rounded-md text-gray-700" />
            <div className="flex flex-wrap justify-end gap-2">
              <a href={linkWhatsapp(link)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50">
                <MessageCircle className="h-4 w-4" aria-hidden />
                Enviar pelo WhatsApp
              </a>
              <button type="button" onClick={copiar} className="inline-flex items-center gap-1.5 px-3 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-800">
                <Copy className="h-4 w-4" aria-hidden />
                Copiar link
              </button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={mudandoAtivo !== null}
        onOpenChange={(open) => !open && setMudandoAtivo(null)}
        title={mudandoAtivo?.situacao === 'inativo' ? 'Reativar usuário?' : 'Desativar usuário?'}
        description={
          mudandoAtivo?.situacao === 'inativo'
            ? `${mudandoAtivo?.nome} volta a entrar no sistema com a senha que já tinha.`
            : `${mudandoAtivo?.nome ?? ''} deixa de entrar no sistema na hora: o login é recusado e a sessão aberta para de valer. O histórico do que a pessoa fez continua.`
        }
        confirmLabel={mudandoAtivo?.situacao === 'inativo' ? 'Reativar' : 'Desativar'}
        variant={mudandoAtivo?.situacao === 'inativo' ? 'default' : 'danger'}
        onConfirm={alternarAtivo}
      />
    </div>
  )
}
