'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { MessageCircle, Pencil, Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import ConfirmDialog from '@/components/ConfirmDialog'
import FormField from '@/components/form/FormField'
import Input from '@/components/form/Input'
import Select from '@/components/form/Select'
import Modal from '@/components/Modal'
import {
  contatoSchema,
  contatoToFormValues,
  emptyContatoFormValues,
  identificadorDoContato,
  rotuloCanal,
  type ContatoFormValues,
  type ContatoListItem,
} from '@/lib/contatos'

import { createContato, deleteContato, updateContato } from './actions'

type Props = {
  contatos: ContatoListItem[]
  obraOptions: { value: string; label: string }[]
}

export default function ContatosPanel({ contatos, obraOptions }: Props) {
  const router = useRouter()
  // null = fechado; 'novo' = criando; item = editando
  const [editando, setEditando] = useState<ContatoListItem | 'novo' | null>(null)
  const [excluindo, setExcluindo] = useState<ContatoListItem | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ContatoFormValues>({
    resolver: zodResolver(contatoSchema),
    defaultValues: emptyContatoFormValues(),
  })

  function abrir(alvo: ContatoListItem | 'novo') {
    reset(alvo === 'novo' ? emptyContatoFormValues() : contatoToFormValues(alvo))
    setEditando(alvo)
  }

  async function salvar(values: ContatoFormValues) {
    const r =
      editando && editando !== 'novo'
        ? await updateContato(editando.id, values)
        : await createContato(values)
    if (!r.ok) {
      toast.error(`Não foi possível salvar: ${r.error}`)
      return
    }
    toast.success(editando === 'novo' ? 'Contato cadastrado' : 'Contato atualizado')
    setEditando(null)
    router.refresh()
  }

  async function excluir() {
    if (!excluindo) return
    const r = await deleteContato(excluindo.id)
    if (!r.ok) {
      toast.error(`Não foi possível excluir: ${r.error}`)
      return
    }
    toast.success('Contato excluído')
    setExcluindo(null)
    router.refresh()
  }

  return (
    <div className="max-w-5xl mx-auto bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <span className="text-sm text-gray-600">
          {contatos.length} {contatos.length === 1 ? 'contato' : 'contatos'}
        </span>
        <button
          type="button"
          onClick={() => abrir('novo')}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-800"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Novo contato
        </button>
      </div>

      {contatos.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <MessageCircle className="h-8 w-8 text-gray-300 mx-auto" aria-hidden />
          <p className="mt-2 text-sm text-gray-600">Nenhum contato cadastrado.</p>
          <p className="text-xs text-gray-500">Sem contato, o bot não aceita documentos de ninguém.</p>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-2">Nome</th>
              <th className="px-4 py-2">Código</th>
              <th className="px-4 py-2">Canal</th>
              <th className="px-4 py-2">Obra</th>
              <th className="px-4 py-2 sr-only">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {contatos.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-2 text-gray-900">{c.nome ?? <span className="text-gray-400">sem nome</span>}</td>
                <td className="px-4 py-2 font-mono text-gray-700">{identificadorDoContato(c)}</td>
                <td className="px-4 py-2 text-gray-600">{rotuloCanal(c.canal)}</td>
                <td className="px-4 py-2 text-gray-600">
                  {c.obra ? [c.obra.codigo_obra, c.obra.nome].filter(Boolean).join(' — ') : <span className="text-amber-700">sem obra</span>}
                </td>
                <td className="px-4 py-2">
                  <div className="flex justify-end gap-1">
                    {c.canal === 'TELEGRAM' && (
                      <button
                        type="button"
                        onClick={() => abrir(c)}
                        className="p-1.5 text-gray-500 hover:text-gray-900 rounded"
                        aria-label={`Editar ${c.nome ?? identificadorDoContato(c)}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setExcluindo(c)}
                      className="p-1.5 text-gray-500 hover:text-red-600 rounded"
                      aria-label={`Excluir ${c.nome ?? identificadorDoContato(c)}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Modal
        open={editando !== null}
        onOpenChange={(open) => !open && setEditando(null)}
        title={editando === 'novo' ? 'Novo contato' : 'Editar contato'}
        dismissible={!isSubmitting}
      >
        <form onSubmit={handleSubmit(salvar)} className="space-y-4" noValidate>
          <FormField
            label="Código do Telegram"
            htmlFor="telegram_chat_id"
            required
            hint="O número que o bot respondeu à pessoa (ex.: 884349214)"
            error={errors.telegram_chat_id?.message}
          >
            <Input id="telegram_chat_id" inputMode="numeric" disabled={isSubmitting} {...register('telegram_chat_id')} />
          </FormField>
          <FormField label="Obra" htmlFor="obra_id" required hint="As propostas dessa pessoa entram nesta obra" error={errors.obra_id?.message}>
            <Select id="obra_id" options={obraOptions} placeholder="Escolha a obra" disabled={isSubmitting} {...register('obra_id')} />
          </FormField>
          <FormField label="Nome" htmlFor="nome" hint="Opcional. Ex.: Lúcio - comprador" error={errors.nome?.message}>
            <Input id="nome" disabled={isSubmitting} {...register('nome')} />
          </FormField>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEditando(null)}
              disabled={isSubmitting}
              className="px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-3 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-800 disabled:opacity-60"
            >
              {isSubmitting ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={excluindo !== null}
        onOpenChange={(open) => !open && setExcluindo(null)}
        title="Excluir contato"
        description={`${excluindo?.nome ?? identificadorDoContato(excluindo ?? { canal: 'TELEGRAM', telegram_chat_id: null, telefone: null })} deixa de poder mandar propostas pelo bot.`}
        confirmLabel="Excluir"
        variant="danger"
        onConfirm={excluir}
      />
    </div>
  )
}
