'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import Modal from '@/components/Modal'
import StatusBadge from '@/components/StatusBadge'
import FormField from '@/components/form/FormField'
import Input from '@/components/form/Input'
import Select from '@/components/form/Select'
import Textarea from '@/components/form/Textarea'
import {
  PROPOSTA_TRANSICOES,
  STATUS_PROPOSTA_LABELS,
} from '@/lib/propostas'
import {
  MOTIVO_REJEICAO_LABELS,
  type MotivoRejeicao,
  type PropostaStatus,
} from '@/lib/types'

import { changePropostaStatus, type ChangeStatusInput } from './actions'

const MOTIVO_OPTIONS: readonly { value: MotivoRejeicao; label: string }[] = (
  Object.keys(MOTIVO_REJEICAO_LABELS) as MotivoRejeicao[]
).map((k) => ({
  value: k,
  label: k === 'outro' ? 'Outro (descrever)' : MOTIVO_REJEICAO_LABELS[k],
}))

const schema = z
  .object({
    novo_status: z.enum(['rascunho', 'enviada', 'aprovada', 'rejeitada'] as const),
    data_envio: z.string().optional().default(''),
    data_decisao: z.string().optional().default(''),
    motivo_rejeicao: z.string().optional().default(''),
    detalhe_rejeicao: z.string().optional().default(''),
  })
  .superRefine((data, ctx) => {
    if (data.novo_status === 'enviada' && !data.data_envio) {
      ctx.addIssue({
        path: ['data_envio'],
        code: 'custom',
        message: 'Data de envio é obrigatória',
      })
    }
    if (data.novo_status === 'aprovada' || data.novo_status === 'rejeitada') {
      if (!data.data_decisao) {
        ctx.addIssue({
          path: ['data_decisao'],
          code: 'custom',
          message: 'Data da decisão é obrigatória',
        })
      }
    }
    if (data.novo_status === 'rejeitada') {
      if (!data.motivo_rejeicao) {
        ctx.addIssue({
          path: ['motivo_rejeicao'],
          code: 'custom',
          message: 'Motivo é obrigatório',
        })
      }
      if (data.motivo_rejeicao === 'outro' && !data.detalhe_rejeicao.trim()) {
        ctx.addIssue({
          path: ['detalhe_rejeicao'],
          code: 'custom',
          message: 'Descreva os detalhes quando o motivo é "Outro"',
        })
      }
    }
  })

type FormValues = z.input<typeof schema>

type StatusDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  propostaId: string
  currentStatus: PropostaStatus
  /** Chamado após sucesso — caller faz router.refresh(). */
  onSuccess: () => void
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function StatusDialog({
  open,
  onOpenChange,
  propostaId,
  currentStatus,
  onSuccess,
}: StatusDialogProps) {
  // O select oferece só os destinos permitidos a partir do status atual —
  // aprovada e rejeitada são terminais (confirmado com a área comercial),
  // então nesses casos a lista vem vazia e o header nem abre o diálogo.
  const destinos = PROPOSTA_TRANSICOES[currentStatus]
  const statusOptions = destinos.map((s) => ({
    value: s,
    label: STATUS_PROPOSTA_LABELS[s],
  }))

  const defaults: FormValues = {
    novo_status: destinos[0] ?? currentStatus,
    data_envio: todayIso(),
    data_decisao: todayIso(),
    motivo_rejeicao: '',
    detalhe_rejeicao: '',
  }

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  })

  // Reabrir sempre parte do estado atual do servidor.
  useEffect(() => {
    if (open) {
      reset({
        novo_status: destinos[0] ?? currentStatus,
        data_envio: todayIso(),
        data_decisao: todayIso(),
        motivo_rejeicao: '',
        detalhe_rejeicao: '',
      })
    }
    // `destinos` é derivado de currentStatus, que já está nas dependências.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentStatus, reset])

  const novoStatus = watch('novo_status')
  const motivoRejeicao = watch('motivo_rejeicao')

  async function onSubmit(values: FormValues) {
    const payload: ChangeStatusInput = {
      novo_status: values.novo_status,
      data_envio: values.data_envio || null,
      data_decisao: values.data_decisao || null,
      motivo_rejeicao:
        values.motivo_rejeicao &&
        MOTIVO_OPTIONS.some((m) => m.value === values.motivo_rejeicao)
          ? (values.motivo_rejeicao as MotivoRejeicao)
          : null,
      detalhe_rejeicao: values.detalhe_rejeicao?.trim() || null,
    }

    const result = await changePropostaStatus(propostaId, payload)

    if (!result.ok) {
      toast.error(`Não foi possível mudar o status: ${result.error}`)
      return
    }

    toast.success('Status atualizado')
    onOpenChange(false)
    onSuccess()
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Mudar status"
      size="md"
      dismissible={!isSubmitting}
    >
      {statusOptions.length === 0 ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Proposta {STATUS_PROPOSTA_LABELS[currentStatus].toLowerCase()} é um
            estado final: a decisão registrada não volta pro funil. Para
            corrigir, crie uma proposta nova.
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Fechar
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <FormField label="Status atual">
            <div className="py-2">
              <StatusBadge status={currentStatus} />
            </div>
          </FormField>

          <FormField
            label="Novo status"
            htmlFor="novo_status"
            required
            error={errors.novo_status?.message}
          >
            <Select
              id="novo_status"
              options={statusOptions}
              disabled={isSubmitting}
              {...register('novo_status')}
            />
          </FormField>

          {novoStatus === 'enviada' && (
            <FormField
              label="Data de envio"
              htmlFor="data_envio"
              required
              error={errors.data_envio?.message}
            >
              <Input
                id="data_envio"
                type="date"
                disabled={isSubmitting}
                {...register('data_envio')}
              />
            </FormField>
          )}

          {(novoStatus === 'aprovada' || novoStatus === 'rejeitada') && (
            <FormField
              label="Data da decisão"
              htmlFor="data_decisao"
              required
              error={errors.data_decisao?.message}
            >
              <Input
                id="data_decisao"
                type="date"
                disabled={isSubmitting}
                {...register('data_decisao')}
              />
            </FormField>
          )}

          {novoStatus === 'rejeitada' && (
            <>
              <FormField
                label="Motivo da rejeição"
                htmlFor="motivo_rejeicao"
                required
                error={errors.motivo_rejeicao?.message}
              >
                <Select
                  id="motivo_rejeicao"
                  options={MOTIVO_OPTIONS}
                  placeholder="— Selecione —"
                  disabled={isSubmitting}
                  {...register('motivo_rejeicao')}
                />
              </FormField>

              <FormField
                label="Detalhes"
                htmlFor="detalhe_rejeicao"
                required={motivoRejeicao === 'outro'}
                hint={
                  motivoRejeicao === 'outro'
                    ? undefined
                    : 'Opcional — adiciona contexto sobre o motivo'
                }
                error={errors.detalhe_rejeicao?.message}
              >
                <Textarea
                  id="detalhe_rejeicao"
                  rows={3}
                  disabled={isSubmitting}
                  {...register('detalhe_rejeicao')}
                />
              </FormField>
            </>
          )}

          {novoStatus === 'rascunho' && (
            <p className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-md p-3">
              Voltar pra rascunho libera a edição da proposta e limpa motivo e
              detalhe de rejeição, que o banco só aceita em proposta rejeitada.
            </p>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200 -mx-6 px-6 -mb-4 pb-4 bg-gray-50 rounded-b-lg">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 rounded-md bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Salvando...' : 'Salvar mudança'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
