'use client'

import { AlertTriangle, FileOutput } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import Input from '@/components/form/Input'
import Select from '@/components/form/Select'
import Modal from '@/components/Modal'
import { avisoDaConversao } from '@/lib/acordos'
import { TIPO_NF_OPTIONS } from '@/lib/notas-fiscais'
import { normalizarChaveNfe, validarPayloadNf } from '@/lib/notas-fiscais-form'
import type { NotaFiscalTipo } from '@/lib/types'

import { converterAcordoEmNf } from './actions'

type Props = {
  acordoId: string
  saldo: number
  recebido: number
  qtdPagamentos: number
  tipoSugerido: NotaFiscalTipo
  hoje: string
}

/**
 * "Converter em NF" (11.4): a NF de saldo, com o aviso explícito do que
 * acontece com os pagamentos já lançados. A obra e o vínculo vêm do acordo.
 */
export default function ConverterDialog({ acordoId, saldo, recebido, qtdPagamentos, tipoSugerido, hoje }: Props) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [numero, setNumero] = useState('')
  const [serie, setSerie] = useState('')
  const [chave, setChave] = useState('')
  const [tipo, setTipo] = useState<string>(tipoSugerido)
  const [emissao, setEmissao] = useState(hoje)
  const [vencimento, setVencimento] = useState('')
  const [valor, setValor] = useState(String(saldo))
  const [obs, setObs] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function converter() {
    const payload = {
      numero: numero.trim(),
      serie: serie.trim() || null,
      chave_nfe: normalizarChaveNfe(chave) || null,
      tipo: tipo as NotaFiscalTipo,
      data_emissao: emissao,
      data_vencimento: vencimento || null,
      valor_total: Number(valor),
      observacao: obs.trim() || null,
    }
    // A regra da NF (9.2) no cliente; a obra e o vínculo, a action pega do acordo.
    const v = validarPayloadNf({ ...payload, obra_id: acordoId, contrato_id: null, proposta_id: null })
    if (!v.ok) return setErro(v.error)
    setSalvando(true)
    const r = await converterAcordoEmNf(acordoId, payload)
    setSalvando(false)
    if (!r.ok) return setErro(r.error)
    toast.success(`Acordo convertido na NF ${payload.numero}`)
    setAberto(false)
    router.refresh()
  }

  const diferente = Math.round(Number(valor) * 100) !== Math.round(saldo * 100)

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="inline-flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded-md text-sm font-medium hover:bg-gray-50 transition-colors"
      >
        <FileOutput size={14} />
        Converter em NF
      </button>
      <Modal
        open={aberto}
        onOpenChange={(o) => !salvando && setAberto(o)}
        title="Converter o acordo em nota fiscal"
        size="md"
        dismissible={!salvando}
        footer={
          <>
            <button type="button" onClick={() => setAberto(false)} disabled={salvando}
              className="px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Voltar
            </button>
            <button type="button" onClick={converter} disabled={salvando}
              className="px-4 py-2 rounded-md bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:bg-gray-400">
              {salvando ? 'Convertendo...' : 'Converter em NF'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div role="note" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-1">
            <p className="flex items-center gap-2 font-semibold"><AlertTriangle size={16} />O que acontece</p>
            <ul className="list-disc pl-5 space-y-1">
              {avisoDaConversao({ recebido, qtdPagamentos, saldo }).map((l) => <li key={l}>{l}</li>)}
            </ul>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-sm text-gray-700">Número
              <Input id="conv_numero" value={numero} onChange={(e) => setNumero(e.target.value)} disabled={salvando} />
            </label>
            <label className="block text-sm text-gray-700">Série
              <Input id="conv_serie" value={serie} onChange={(e) => setSerie(e.target.value)} disabled={salvando} />
            </label>
            <label className="block text-sm text-gray-700 sm:col-span-2">Chave da NF-e (opcional)
              <Input id="conv_chave" inputMode="numeric" value={chave} onChange={(e) => setChave(e.target.value)} disabled={salvando} />
            </label>
            <label className="block text-sm text-gray-700">Tipo
              <Select id="conv_tipo" options={TIPO_NF_OPTIONS} value={tipo} onChange={(e) => setTipo(e.target.value)} disabled={salvando} />
            </label>
            <label className="block text-sm text-gray-700">Valor (R$)
              <Input id="conv_valor" type="number" inputMode="decimal" step="0.01" min="0.01" value={valor} onChange={(e) => setValor(e.target.value)} disabled={salvando} />
            </label>
            <label className="block text-sm text-gray-700">Emissão
              <Input id="conv_emissao" type="date" value={emissao} onChange={(e) => setEmissao(e.target.value)} disabled={salvando} />
            </label>
            <label className="block text-sm text-gray-700">Vencimento
              <Input id="conv_vencimento" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} disabled={salvando} />
            </label>
            <label className="block text-sm text-gray-700 sm:col-span-2">Observação
              <Input id="conv_obs" value={obs} onChange={(e) => setObs(e.target.value)} disabled={salvando} />
            </label>
          </div>
          {diferente && (
            <p className="text-xs text-amber-800">O valor é diferente do saldo do acordo: o saldo da obra vai mudar na mesma diferença.</p>
          )}
          {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
        </div>
      </Modal>
    </>
  )
}
