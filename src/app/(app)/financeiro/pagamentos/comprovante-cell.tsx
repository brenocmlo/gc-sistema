'use client'

import { ExternalLink, Loader2, Paperclip } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  ACCEPT_COMPROVANTE,
  BUCKET_COMPROVANTE,
  conteudoPareceComprovante,
  MIME_COMPROVANTE,
  validarComprovante,
} from '@/lib/pagamento-comprovante'
import { fileExtension } from '@/lib/files'
import { createClient } from '@/lib/supabase/client'

import { prepararEnvioComprovante, registrarComprovante, urlComprovante } from './comprovante-actions'

type Props = {
  pagamentoId: string
  temComprovante: boolean
  podeEnviar: boolean
}

/** Ver, anexar e substituir o comprovante (10.4), na listagem e na aba Pagamentos da NF. */
export default function ComprovanteCell({ pagamentoId, temComprovante, podeEnviar }: Props) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [enviando, setEnviando] = useState(false)
  const [abrindo, setAbrindo] = useState(false)

  async function enviar(arquivo: File) {
    const invalido = validarComprovante(arquivo)
    if (invalido) return void toast.error(invalido)
    if (!conteudoPareceComprovante(arquivo.name, new Uint8Array(await arquivo.slice(0, 16).arrayBuffer()))) {
      return void toast.error('O conteúdo do arquivo não bate com a extensão')
    }
    setEnviando(true)
    try {
      const prep = await prepararEnvioComprovante(pagamentoId, arquivo.name)
      if (!prep.ok) return void toast.error(prep.error)
      const { error } = await createClient()
        .storage.from(BUCKET_COMPROVANTE)
        .uploadToSignedUrl(prep.path, prep.token, arquivo, { contentType: MIME_COMPROVANTE[fileExtension(arquivo.name)] })
      if (error) return void toast.error(`Não foi possível enviar: ${error.message}`)
      const reg = await registrarComprovante(pagamentoId, prep.path)
      if (!reg.ok) return void toast.error(reg.error)
      toast.success(temComprovante ? 'Comprovante substituído' : 'Comprovante anexado')
      router.refresh()
    } finally {
      setEnviando(false)
    }
  }

  async function abrir() {
    setAbrindo(true)
    const r = await urlComprovante(pagamentoId)
    setAbrindo(false)
    if (!r.ok) return void toast.error(`Não foi possível abrir: ${r.error}`)
    window.open(r.url, '_blank', 'noopener,noreferrer')
  }

  if (!temComprovante && !podeEnviar) return <span className="text-gray-400">—</span>

  return (
    <div className="flex items-center gap-3 whitespace-nowrap" data-comprovante={pagamentoId}>
      {temComprovante && (
        <button
          type="button"
          onClick={abrir}
          disabled={abrindo}
          className="inline-flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-gray-900 disabled:opacity-50"
        >
          <ExternalLink size={14} />
          {abrindo ? 'Abrindo...' : 'Ver'}
        </button>
      )}
      {podeEnviar && (
        <>
          <input
            ref={input}
            type="file"
            accept={ACCEPT_COMPROVANTE}
            aria-label="Arquivo do comprovante"
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
            className="inline-flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-gray-900 disabled:opacity-50"
          >
            {enviando ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
            {enviando ? 'Enviando...' : temComprovante ? 'Substituir' : 'Anexar'}
          </button>
        </>
      )}
    </div>
  )
}
