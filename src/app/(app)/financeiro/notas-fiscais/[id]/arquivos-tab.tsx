'use client'

import { ExternalLink, FileCode, FileText, Loader2, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  ACCEPT_ARQUIVO_NF,
  ARQUIVO_NF_LABELS,
  BUCKET_NF,
  conteudoPareceDoTipo,
  MIME_ARQUIVO_NF,
  TIPOS_ARQUIVO_NF,
  validarArquivoNf,
  type TipoArquivoNf,
} from '@/lib/nf-arquivos'
import { createClient } from '@/lib/supabase/client'

import { prepararEnvioArquivoNf, registrarArquivoNf, urlArquivoNf } from './arquivos-actions'

type Props = {
  nfId: string
  xml: string | null
  pdf: string | null
  /** Admin e financeiro, e a NF não cancelada. */
  podeEnviar: boolean
  cancelada: boolean
}

/** Aba Arquivos da NF (9.5): um XML e um PDF, cada um com enviar, visualizar e substituir. */
export default function ArquivosTab({ nfId, xml, pdf, podeEnviar, cancelada }: Props) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
      {TIPOS_ARQUIVO_NF.map((tipo) => (
        <LinhaArquivo key={tipo} nfId={nfId} tipo={tipo} caminho={tipo === 'xml' ? xml : pdf} podeEnviar={podeEnviar} />
      ))}
      {cancelada && (
        <p className="p-4 text-xs text-gray-500">Nota fiscal cancelada: os arquivos ficam como estão, sem envio nem substituição.</p>
      )}
    </div>
  )
}

function LinhaArquivo({
  nfId,
  tipo,
  caminho,
  podeEnviar,
}: {
  nfId: string
  tipo: TipoArquivoNf
  caminho: string | null
  podeEnviar: boolean
}) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [enviando, setEnviando] = useState(false)
  const [abrindo, setAbrindo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const Icone = tipo === 'xml' ? FileCode : FileText

  async function enviar(arquivo: File) {
    const invalido = validarArquivoNf(tipo, arquivo)
    if (invalido) return setErro(invalido)
    if (!conteudoPareceDoTipo(tipo, await arquivo.slice(0, 64).text())) {
      return setErro(`O conteúdo não é de um arquivo ${tipo.toUpperCase()}`)
    }
    setErro(null)
    setEnviando(true)
    try {
      const prep = await prepararEnvioArquivoNf(nfId, tipo)
      if (!prep.ok) return setErro(prep.error)
      const { error } = await createClient()
        .storage.from(BUCKET_NF)
        .uploadToSignedUrl(prep.path, prep.token, arquivo, { contentType: MIME_ARQUIVO_NF[tipo], upsert: true })
      if (error) return setErro(`Não foi possível enviar: ${error.message}`)
      const reg = await registrarArquivoNf(nfId, tipo)
      if (!reg.ok) return setErro(reg.error)
      toast.success(`${ARQUIVO_NF_LABELS[tipo]} ${caminho ? 'substituído' : 'enviado'}`)
      router.refresh()
    } finally {
      setEnviando(false)
    }
  }

  async function abrir() {
    setAbrindo(true)
    const r = await urlArquivoNf(nfId, tipo)
    setAbrindo(false)
    if (!r.ok) return toast.error(`Não foi possível abrir: ${r.error}`)
    window.open(r.url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div data-arquivo-nf={tipo} className="p-4 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Icone size={20} className="text-gray-400 shrink-0" />
          <div>
            <p className="text-sm font-medium text-gray-900">{ARQUIVO_NF_LABELS[tipo]}</p>
            <p className="text-xs text-gray-500">{caminho ? 'Enviado' : 'Nenhum arquivo'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {caminho && (
            <button
              type="button"
              onClick={abrir}
              disabled={abrindo}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <ExternalLink size={14} />
              {abrindo ? 'Abrindo...' : 'Visualizar'}
            </button>
          )}
          {podeEnviar && (
            <>
              <input
                ref={input}
                type="file"
                accept={ACCEPT_ARQUIVO_NF[tipo]}
                aria-label={`Arquivo ${tipo.toUpperCase()} da nota fiscal`}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) void enviar(f)
                }}
              />
              <button
                type="button"
                onClick={() => input.current?.click()}
                disabled={enviando}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:bg-gray-400"
              >
                {enviando ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {enviando ? 'Enviando...' : caminho ? 'Substituir' : `Enviar ${tipo.toUpperCase()}`}
              </button>
            </>
          )}
        </div>
      </div>
      {erro && (
        <p role="alert" className="text-sm text-red-700">
          {erro}
        </p>
      )}
    </div>
  )
}
