'use client'

import { ExternalLink, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import ConfirmDialog from '@/components/ConfirmDialog'
import FileUpload, { type UploadResult } from '@/components/FileUpload'
import { podeExcluirAnexo } from '@/lib/anexos'
import {
  BUCKET_EVIDENCIAS,
  caminhoDaEvidencia,
  EVIDENCIA_ACCEPT,
  EVIDENCIA_DICA,
  temMiniatura,
  tipoDaEvidencia,
  validarEvidencia,
  type Evidencia,
} from '@/lib/evidencias'
import type { Etapa } from '@/lib/execucao'
import { iconForFile } from '@/lib/file-icons'
import { formatFileSize } from '@/lib/files'
import { formatDate } from '@/lib/format'
import { createClient } from '@/lib/supabase/client'

import { excluirEvidencia, registrarEvidencia, type EvidenciasResult } from './evidencias-actions'

type Props = {
  etapa: Etapa
  execucaoId: string
  empresaId: string
  obraId: string
  evidencias: Evidencia[]
  urls: Record<string, string>
  /** Admin, produção e medição. O visualizador só vê a galeria. */
  podeAnexar: boolean
  perfil: string
  userId: string
  updatedAtVisto: string | null
  /** O jsonb novo que voltou da action, para o painel trocar a lista. */
  onMudou: (r: Extract<EvidenciasResult, { ok: true }>) => void
}

/** Galeria e upload das evidências de uma etapa, dentro do painel de apontamento. */
export default function EvidenciasEtapa({
  etapa,
  execucaoId,
  empresaId,
  obraId,
  evidencias,
  urls,
  podeAnexar,
  perfil,
  userId,
  updatedAtVisto,
  onMudou,
}: Props) {
  const [excluindo, setExcluindo] = useState<Evidencia | null>(null)

  async function subir(file: File): Promise<UploadResult> {
    // Direto do navegador para o bucket: a Server Action tem teto de 1 MB.
    const caminho = caminhoDaEvidencia({ empresaId, obraId, execucaoId, etapa }, file.name)
    const { error } = await createClient()
      .storage.from(BUCKET_EVIDENCIAS)
      .upload(caminho, file, { contentType: tipoDaEvidencia(file) ?? undefined, upsert: false })
    if (error) return { ok: false, error: error.message }
    const r = await registrarEvidencia(execucaoId, etapa, { caminho, nome: file.name, tamanho: file.size }, updatedAtVisto)
    if (!r.ok) {
      // Sem registro, o arquivo não aparece em lugar nenhum: tira do bucket.
      await createClient().storage.from(BUCKET_EVIDENCIAS).remove([caminho])
      return { ok: false, error: r.error }
    }
    onMudou(r)
    return { ok: true }
  }

  async function excluir() {
    if (!excluindo) return
    const r = await excluirEvidencia(execucaoId, excluindo.path, updatedAtVisto)
    if (!r.ok) {
      toast.error(`Não foi possível excluir: ${r.error}`)
      return
    }
    toast.success('Evidência excluída')
    setExcluindo(null)
    onMudou(r)
  }

  return (
    <div data-evidencias={etapa} className="space-y-2">
      <p className="text-xs font-medium text-gray-700">
        Evidências{evidencias.length > 0 ? ` (${evidencias.length})` : ''}
      </p>

      {evidencias.length === 0 ? (
        <p className="text-xs text-gray-500">Nenhuma evidência nesta etapa.</p>
      ) : (
        <ul className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {evidencias.map((e) => {
            const url = urls[e.path]
            const Icon = iconForFile(e.tipo, e.nome)
            return (
              <li key={e.path} className="relative group border border-gray-200 rounded-md overflow-hidden bg-gray-50">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Abrir ${e.nome}`}
                  title={`${e.nome} · ${formatFileSize(e.tamanho)} · ${formatDate(e.uploaded_at)}`}
                  className="block aspect-square"
                  onClick={(ev) => !url && ev.preventDefault()}
                >
                  {url && temMiniatura(e) ? (
                    // eslint-disable-next-line @next/next/no-img-element -- URL assinada do Storage, sem next/image
                    <img src={url} alt={e.nome} className="w-full h-full object-cover" />
                  ) : (
                    <span className="flex flex-col items-center justify-center h-full p-1 text-center">
                      <Icon size={22} className="text-gray-400" />
                      <span className="mt-1 text-[10px] text-gray-600 line-clamp-2 break-all">{e.nome}</span>
                    </span>
                  )}
                  <ExternalLink size={12} className="absolute top-1 left-1 text-white drop-shadow opacity-0 group-hover:opacity-100" />
                </a>
                {podeAnexar && podeExcluirAnexo(e, { perfil, userId }) && (
                  <button
                    type="button"
                    onClick={() => setExcluindo(e)}
                    aria-label={`Excluir ${e.nome}`}
                    className="absolute top-1 right-1 p-2.5 sm:p-1.5 rounded bg-white/90 text-red-600 hover:bg-white"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {podeAnexar && (
        <FileUpload
          uploadFn={subir}
          accept={EVIDENCIA_ACCEPT}
          validar={(f) => validarEvidencia(f)}
          dica={EVIDENCIA_DICA}
          captura
        />
      )}

      <ConfirmDialog
        open={excluindo !== null}
        onOpenChange={(o) => !o && setExcluindo(null)}
        title="Excluir evidência?"
        description={excluindo ? `"${excluindo.nome}" será removida permanentemente desta etapa.` : ''}
        variant="danger"
        confirmLabel="Excluir"
        onConfirm={excluir}
      />
    </div>
  )
}
