'use client'

import { Bot, Check, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { aceitarDocumento, recusarDocumento } from '@/app/(app)/documentos/actions'
import FormField from '@/components/form/FormField'
import Textarea from '@/components/form/Textarea'
import Modal from '@/components/Modal'
import { validarMotivoRecusa } from '@/lib/documentos'

/**
 * Faixa "criado pela automação — confira" (Breno, 25/09: aceitar ou não).
 * Aparece no detalhe do documento, da proposta e do contrato enquanto ninguém
 * conferiu. Aceitar: admin e comercial. Não aceitar apaga o que o bot criou —
 * só admin (é quem pode excluir pela RLS).
 */
export default function ConferenciaAutomacao({
  documentoId,
  oQue,
  podeAceitar,
  podeRecusar,
  mostrarLinkDocumento = true,
}: {
  documentoId: string
  oQue: 'proposta' | 'contrato'
  podeAceitar: boolean
  podeRecusar: boolean
  mostrarLinkDocumento?: boolean
}) {
  const router = useRouter()
  const [recusando, setRecusando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const artigo = oQue === 'proposta' ? 'a' : 'o'

  async function aceitar() {
    setSalvando(true)
    const r = await aceitarDocumento(documentoId)
    setSalvando(false)
    if (!r.ok) return void toast.error(r.error)
    toast.success(`Conferido: ${oQue} mantid${artigo}`)
    router.refresh()
  }

  async function recusar() {
    const v = validarMotivoRecusa(motivo)
    if (!v.ok) return setErro(v.error)
    setErro(null)
    setSalvando(true)
    const r = await recusarDocumento(documentoId, v.motivo)
    setSalvando(false)
    if (!r.ok) return void toast.error(r.error)
    toast.success(`${oQue === 'proposta' ? 'Proposta desfeita' : 'Contrato desfeito'}; o documento voltou para revisão`)
    setRecusando(false)
    // A proposta/contrato não existe mais: volta ao documento.
    router.push(`/documentos/${documentoId}`)
    router.refresh()
  }

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3 flex-wrap">
      <Bot className="h-5 w-5 text-blue-700 mt-0.5 shrink-0" aria-hidden />
      <div className="flex-1 min-w-[220px] text-sm text-blue-900">
        <p className="font-medium">
          {oQue === 'proposta' ? 'Proposta criada' : 'Contrato criado'} pela automação — confira
        </p>
        <p className="text-blue-800">
          Veja se os dados e os itens batem com o PDF.
          {mostrarLinkDocumento && (
            <>
              {' '}
              <Link href={`/documentos/${documentoId}`} className="underline underline-offset-2">
                Ver o documento recebido
              </Link>
            </>
          )}
        </p>
      </div>
      {(podeAceitar || podeRecusar) && (
        <div className="flex gap-2">
          {podeAceitar && (
            <button
              type="button"
              onClick={aceitar}
              disabled={salvando}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-800 disabled:opacity-60"
            >
              <Check size={14} /> Aceitar
            </button>
          )}
          {podeRecusar && (
            <button
              type="button"
              onClick={() => setRecusando(true)}
              disabled={salvando}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md border border-red-200 text-red-700 bg-white hover:bg-red-50 disabled:opacity-60"
            >
              <X size={14} /> Não aceitar
            </button>
          )}
        </div>
      )}

      <Modal open={recusando} onOpenChange={(o) => !o && !salvando && setRecusando(false)} title="Não aceitar" dismissible={!salvando}>
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            {oQue === 'proposta' ? 'A proposta criada' : 'O contrato criado'} pelo bot é apagad{artigo}, com os itens e o PDF
            anexado. O documento volta para revisão com o motivo, e dá para reprocessar ou vincular depois.
          </p>
          <FormField label="O que estava errado" htmlFor="conf_motivo" required hint="Ex.: valor total errado, obra errada, itens faltando">
            <Textarea id="conf_motivo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={salvando} />
          </FormField>
          {erro && <p className="text-sm text-red-600">{erro}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setRecusando(false)} disabled={salvando} className="px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50">
              Cancelar
            </button>
            <button type="button" onClick={recusar} disabled={salvando} className="px-3 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 disabled:opacity-60">
              {salvando ? 'Desfazendo…' : 'Não aceitar'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
