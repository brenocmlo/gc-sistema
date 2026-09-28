'use client'

import { Ban, Link2, RotateCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import FormField from '@/components/form/FormField'
import Select from '@/components/form/Select'
import Textarea from '@/components/form/Textarea'
import Modal from '@/components/Modal'
import { validarMotivoDescarte } from '@/lib/documentos'

import { descartarDocumento, reprocessarDocumento, vincularDocumento } from '../actions'

type Opcao = { value: string; label: string }
type Acao = 'reprocessar' | 'vincular' | 'descartar' | null

const BOTAO = 'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md border'

export default function RevisaoPanel({
  documentoId,
  obraAtual,
  obraOptions,
  propostaOptions,
  contratoOptions,
}: {
  documentoId: string
  obraAtual: string | null
  obraOptions: Opcao[]
  propostaOptions: Opcao[]
  contratoOptions: Opcao[]
}) {
  const router = useRouter()
  const [acao, setAcao] = useState<Acao>(null)
  const [obraId, setObraId] = useState(obraAtual ?? '')
  const [destino, setDestino] = useState('')
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  function abrir(a: Acao) {
    setErro(null)
    setAcao(a)
  }

  async function confirmar() {
    setErro(null)
    let r: { ok: true; aviso?: string } | { ok: false; error: string }
    if (acao === 'reprocessar') {
      if (!obraId) return setErro('Escolha a obra')
      setSalvando(true)
      r = await reprocessarDocumento(documentoId, obraId)
    } else if (acao === 'vincular') {
      // valor do select: "proposta:<id>" ou "contrato:<id>"
      const [tipo, id] = destino.split(':')
      if (!id) return setErro('Escolha a proposta ou o contrato')
      setSalvando(true)
      r = await vincularDocumento(documentoId, { tipo: tipo as 'proposta' | 'contrato', id })
    } else {
      const v = validarMotivoDescarte(motivo)
      if (!v.ok) return setErro(v.error)
      setSalvando(true)
      r = await descartarDocumento(documentoId, v.motivo)
    }
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.error)
      return
    }
    if (acao === 'reprocessar') {
      if (r.aviso) toast.warning(`Documento voltou para a fila, mas ${r.aviso}.`)
      else toast.success('Documento enviado para nova leitura. Leva até 1 minuto.')
    } else if (acao === 'vincular') toast.success('Documento vinculado')
    else toast.success('Documento descartado')
    setAcao(null)
    router.refresh()
  }

  const destinoOptions: Opcao[] = [
    ...propostaOptions.map((o) => ({ value: `proposta:${o.value}`, label: `Proposta ${o.label}` })),
    ...contratoOptions.map((o) => ({ value: `contrato:${o.value}`, label: `Contrato ${o.label}` })),
  ]
  const titulos = { reprocessar: 'Reprocessar documento', vincular: 'Vincular a proposta ou contrato', descartar: 'Descartar documento' }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Resolver</h2>
        <p className="text-xs text-gray-500">Este documento ainda precisa de uma ação.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => abrir('reprocessar')} className={`${BOTAO} bg-gray-900 text-white border-gray-900 hover:bg-gray-800`}>
          <RotateCw size={14} /> Reprocessar
        </button>
        <button type="button" onClick={() => abrir('vincular')} className={`${BOTAO} text-gray-700 border-gray-300 hover:bg-gray-50`}>
          <Link2 size={14} /> Vincular
        </button>
        <button type="button" onClick={() => abrir('descartar')} className={`${BOTAO} text-red-700 border-red-200 hover:bg-red-50`}>
          <Ban size={14} /> Descartar
        </button>
      </div>

      <Modal open={acao !== null} onOpenChange={(o) => !o && !salvando && setAcao(null)} title={acao ? titulos[acao] : ''} dismissible={!salvando}>
        <div className="space-y-4">
          {acao === 'reprocessar' && (
            <>
              <p className="text-sm text-gray-600">A leitura automática roda de novo sobre o mesmo PDF. Troque a obra se o problema foi esse.</p>
              <FormField label="Obra" htmlFor="rev_obra" required>
                <Select id="rev_obra" options={obraOptions} placeholder="Escolha a obra" value={obraId} onChange={(e) => setObraId(e.target.value)} disabled={salvando} />
              </FormField>
            </>
          )}
          {acao === 'vincular' && (
            <>
              <p className="text-sm text-gray-600">Para quando a equipe já cadastrou à mão. O documento passa a apontar para ela.</p>
              <FormField label="Proposta ou contrato" htmlFor="rev_destino" required hint={destinoOptions.length ? undefined : 'Não há proposta nem contrato nesta obra'}>
                <Select id="rev_destino" options={destinoOptions} placeholder="Escolha" value={destino} onChange={(e) => setDestino(e.target.value)} disabled={salvando} />
              </FormField>
            </>
          )}
          {acao === 'descartar' && (
            <>
              <p className="text-sm text-gray-600">Nada é gravado. O documento fica na lista como descartado, com o motivo.</p>
              <FormField label="Motivo" htmlFor="rev_motivo" required hint="Ex.: PDF duplicado, documento de outra empresa">
                <Textarea id="rev_motivo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={salvando} />
              </FormField>
            </>
          )}
          {erro && <p className="text-sm text-red-600">{erro}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setAcao(null)} disabled={salvando} className="px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50">
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmar}
              disabled={salvando}
              className={`px-3 py-2 text-sm font-medium rounded-md text-white disabled:opacity-60 ${acao === 'descartar' ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-900 hover:bg-gray-800'}`}
            >
              {salvando ? 'Salvando…' : acao === 'descartar' ? 'Descartar' : acao === 'vincular' ? 'Vincular' : 'Reprocessar'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
