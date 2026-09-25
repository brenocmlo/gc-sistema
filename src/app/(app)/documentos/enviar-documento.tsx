'use client'

import { Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import FormField from '@/components/form/FormField'
import Select from '@/components/form/Select'
import Modal from '@/components/Modal'
import { caminhoDeEnvio, validarPdfParaEnvio } from '@/lib/documentos'
import { createClient } from '@/lib/supabase/client'

import { registrarEnvioDocumento } from './actions'

export default function EnviarDocumento({
  empresaId,
  obraOptions,
}: {
  empresaId: string
  obraOptions: { value: string; label: string }[]
}) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [obraId, setObraId] = useState('')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  function fechar() {
    if (enviando) return
    setAberto(false)
    setObraId('')
    setArquivo(null)
    setErro(null)
  }

  async function enviar() {
    if (!obraId) return setErro('Escolha a obra')
    if (!arquivo) return setErro('Escolha o PDF')
    const invalido = validarPdfParaEnvio(arquivo)
    if (invalido) return setErro(invalido)
    setErro(null)
    setEnviando(true)
    try {
      // O PDF vai direto do navegador para o Storage (policy: admin/comercial,
      // pasta da própria empresa); a action só registra e aciona a leitura.
      const caminho = caminhoDeEnvio(empresaId, arquivo.name)
      const { error: erroUpload } = await createClient()
        .storage.from('documentos-processamento')
        .upload(caminho, arquivo, { contentType: 'application/pdf', upsert: false })
      if (erroUpload) {
        toast.error(`Não foi possível enviar o arquivo: ${erroUpload.message}`)
        return
      }
      const r = await registrarEnvioDocumento({ caminho, obraId, nomeArquivo: arquivo.name })
      if (!r.ok) {
        toast.error(`Não foi possível registrar: ${r.error}`)
        return
      }
      if (r.automacao === 'acionada') toast.success('Documento enviado. A leitura automática leva até 1 minuto.')
      else toast.warning(`Documento registrado, mas ${r.aviso ?? 'a leitura automática não foi acionada'}.`)
      setAberto(false)
      router.push(`/documentos/${r.id}`)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="inline-flex items-center gap-2 bg-gray-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-800 whitespace-nowrap"
      >
        <Upload size={16} />
        Enviar documento
      </button>
      <Modal open={aberto} onOpenChange={(o) => !o && fechar()} title="Enviar documento" dismissible={!enviando}>
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            O PDF passa pela mesma leitura automática do bot do Telegram. Proposta vira proposta
            com os itens; o que não der para ler vai para revisão.
          </p>
          <FormField label="Obra" htmlFor="envio_obra" required>
            <Select id="envio_obra" options={obraOptions} placeholder="Escolha a obra" value={obraId} onChange={(e) => setObraId(e.target.value)} disabled={enviando} />
          </FormField>
          <FormField label="Arquivo PDF" htmlFor="envio_arquivo" required hint="Até 20 MB">
            <input
              id="envio_arquivo"
              type="file"
              accept="application/pdf,.pdf"
              disabled={enviando}
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-gray-700 file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border-0 file:bg-gray-100 file:text-gray-700"
            />
          </FormField>
          {erro && <p className="text-sm text-red-600">{erro}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={fechar} disabled={enviando} className="px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50">
              Cancelar
            </button>
            <button type="button" onClick={enviar} disabled={enviando} className="px-3 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-800 disabled:opacity-60">
              {enviando ? 'Enviando…' : 'Enviar'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
