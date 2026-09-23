'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import Modal from '@/components/Modal'
import StatusBadge from '@/components/StatusBadge'
import FormField from '@/components/form/FormField'
import Select from '@/components/form/Select'
import Textarea from '@/components/form/Textarea'
import {
  CONTRATO_TRANSICOES,
  MOTIVO_RESCISAO_OPTIONS,
  STATUS_CONTRATO_LABELS,
  isMotivoRescisao,
} from '@/lib/contratos'
import type { ContratoStatus } from '@/lib/types'

import { changeContratoStatus } from './actions'

const MOTIVO_OPTIONS = MOTIVO_RESCISAO_OPTIONS.map((m) => ({
  value: m.value,
  label: m.value === 'outro' ? 'Outro (descrever)' : m.label,
}))

// Mesma regra de validarRescisao (src/lib/contratos.ts), que a action repete.
const schema = z
  .object({
    novo_status: z.enum(['ativo', 'suspenso', 'concluido', 'rescindido'] as const),
    motivo_rescisao: z.string().optional().default(''),
    detalhe_rescisao: z.string().max(1000, 'Máximo 1000 caracteres').optional().default(''),
  })
  .superRefine((data, ctx) => {
    if (data.novo_status !== 'rescindido') return
    if (!data.motivo_rescisao) {
      ctx.addIssue({ path: ['motivo_rescisao'], code: 'custom', message: 'Motivo é obrigatório' })
    }
    if (data.motivo_rescisao === 'outro' && !data.detalhe_rescisao.trim()) {
      ctx.addIssue({
        path: ['detalhe_rescisao'],
        code: 'custom',
        message: 'Descreva o motivo quando escolher "Outro"',
      })
    }
  })

type FormValues = z.input<typeof schema>

type StatusDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  contratoId: string
  currentStatus: ContratoStatus
  /** Chamado após sucesso — caller faz router.refresh(). */
  onSuccess: () => void
}

export default function StatusDialog({
  open,
  onOpenChange,
  contratoId,
  currentStatus,
  onSuccess,
}: StatusDialogProps) {
  // Só os destinos permitidos a partir do status atual. Concluído e
  // rescindido são terminais, e o header nem mostra o botão.
  const destinos = CONTRATO_TRANSICOES[currentStatus]
  const statusOptions = destinos.map((s) => ({ value: s, label: STATUS_CONTRATO_LABELS[s] }))

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      novo_status: destinos[0] ?? currentStatus,
      motivo_rescisao: '',
      detalhe_rescisao: '',
    },
  })

  // Reabrir sempre parte do estado atual do servidor.
  useEffect(() => {
    if (open) {
      reset({ novo_status: destinos[0] ?? currentStatus, motivo_rescisao: '', detalhe_rescisao: '' })
    }
    // `destinos` é derivado de currentStatus, que já está nas dependências.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentStatus, reset])

  const novoStatus = watch('novo_status')
  const motivo = watch('motivo_rescisao')

  async function onSubmit(values: FormValues) {
    const rescindir = values.novo_status === 'rescindido'
    const result = await changeContratoStatus(contratoId, {
      novo_status: values.novo_status,
      motivo_rescisao:
        rescindir && isMotivoRescisao(values.motivo_rescisao) ? values.motivo_rescisao : null,
      detalhe_rescisao: rescindir ? values.detalhe_rescisao?.trim() || null : null,
    })

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

        {novoStatus === 'rescindido' && (
          <>
            <FormField
              label="Motivo da rescisão"
              htmlFor="motivo_rescisao"
              required
              error={errors.motivo_rescisao?.message}
            >
              <Select
                id="motivo_rescisao"
                options={MOTIVO_OPTIONS}
                placeholder="— Selecione —"
                disabled={isSubmitting}
                {...register('motivo_rescisao')}
              />
            </FormField>

            <FormField
              label="Detalhamento"
              htmlFor="detalhe_rescisao"
              required={motivo === 'outro'}
              hint={motivo === 'outro' ? undefined : 'Opcional — adiciona contexto sobre o motivo'}
              error={errors.detalhe_rescisao?.message}
            >
              <Textarea
                id="detalhe_rescisao"
                rows={3}
                disabled={isSubmitting}
                {...register('detalhe_rescisao')}
              />
            </FormField>
          </>
        )}

        {(novoStatus === 'concluido' || novoStatus === 'rescindido') && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-3">
            {STATUS_CONTRATO_LABELS[novoStatus]} é um estado final: o contrato não volta a
            ativo, e itens e dados deixam de ser editáveis. Anexos continuam liberados.
          </p>
        )}

        {novoStatus === 'suspenso' && (
          <p className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-md p-3">
            Contrato suspenso não é editável. Ele pode voltar a ativo ou ser rescindido depois.
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
    </Modal>
  )
}
