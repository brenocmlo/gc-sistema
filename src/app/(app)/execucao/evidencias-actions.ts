'use server'

import { autorizarExclusaoDeAnexo, removeuDoStorage } from '@/lib/anexos'
import {
  BUCKET_EVIDENCIAS,
  caminhoEhDaEvidencia,
  lerEvidencias,
  tipoDaEvidencia,
  type Evidencia,
} from '@/lib/evidencias'
import { isEtapa } from '@/lib/execucao'
import { createClient } from '@/lib/supabase/server'
import type { ExecucaoUpdate } from '@/lib/types'

// Evidências por etapa (bloco 8.1). O arquivo NÃO passa por aqui: o navegador
// sobe direto para o bucket `evidencias` (a policy de insert é a mesma lista de
// perfis), porque o limite de corpo da Server Action é 1 MB e foto de celular
// passa disso. Estas actions só registram, excluem e assinam URL.

/** Quem aponta é quem anexa evidência: as policies de update da execução. */
const PERFIS_QUE_APONTAM = ['admin', 'producao', 'medicao']
/** O layout de /execucao. */
const PERFIS_QUE_VEEM = ['admin', 'producao', 'medicao', 'visualizador']

const TENTATIVAS = 3

export type EvidenciasResult =
  | {
      ok: true
      evidencias: Evidencia[]
      /** O `updated_at` depois da gravação. */
      updatedAt: string
      /**
       * true quando alguém mudou a execução entre o painel abrir e esta
       * gravação. O painel NÃO adota o `updatedAt` novo nesse caso, para o
       * "Salvar" ainda acusar o conflito do apontamento alheio.
       */
      outraMudanca: boolean
    }
  | { ok: false; error: string }

async function sessao(perfis: string[], acao: string) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: 'Não autenticado' }
  const { data: profile } = await supabase
    .from('profiles')
    .select('empresa_id, perfil')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile) return { ok: false as const, error: 'Perfil não configurado' }
  // O guard do layout protege a rota; a action repete por conta própria.
  if (!perfis.includes(profile.perfil)) return { ok: false as const, error: `Sem permissão pra ${acao}` }
  return { ok: true as const, supabase, userId: user.id, empresaId: profile.empresa_id, perfil: profile.perfil }
}

type Cliente = ReturnType<typeof createClient>

async function lerLinha(supabase: Cliente, id: string) {
  const { data, error } = await supabase
    .from('execucao')
    .select('id, empresa_id, updated_at, evidencias, item:itens!inner(obra_id)')
    .eq('id', id)
    .maybeSingle()
  if (error) return { ok: false as const, error: error.message }
  if (!data) return { ok: false as const, error: 'Execução não encontrada' }
  return { ok: true as const, linha: data }
}

/**
 * Troca o jsonb com lock otimista pelo `updated_at` e tenta de novo se perdeu a
 * corrida: dois uploads ao mesmo tempo não podem apagar um ao outro, e mudança
 * de evidência não briga com apontamento (são campos diferentes).
 */
async function gravarEvidencias(
  supabase: Cliente,
  id: string,
  updatedAtVisto: string | null,
  mudar: (atuais: Evidencia[]) => { ok: true; lista: Evidencia[] } | { ok: false; error: string },
): Promise<EvidenciasResult> {
  let primeiraLeitura: string | null = null
  for (let tentativa = 0; tentativa < TENTATIVAS; tentativa++) {
    const lida = await lerLinha(supabase, id)
    if (!lida.ok) return lida
    primeiraLeitura ??= lida.linha.updated_at
    const mudanca = mudar(lerEvidencias(lida.linha.evidencias))
    if (!mudanca.ok) return mudanca
    const base = supabase
      .from('execucao')
      .update({ evidencias: mudanca.lista as unknown as ExecucaoUpdate['evidencias'] })
      .eq('id', id)
    const visto = lida.linha.updated_at
    const { data, error } = await (visto === null ? base.is('updated_at', null) : base.eq('updated_at', visto))
      .select('updated_at')
      .maybeSingle()
    if (error) return { ok: false, error: error.message }
    if (data) {
      return {
        ok: true,
        evidencias: mudanca.lista,
        updatedAt: data.updated_at ?? '',
        // Mudou se a linha já não era a que o painel viu, ou se foi preciso
        // tentar de novo (alguém gravou entre a leitura e o update).
        outraMudanca: primeiraLeitura !== updatedAtVisto || tentativa > 0,
      }
    }
  }
  return { ok: false, error: 'A execução mudou várias vezes seguidas. Tente de novo.' }
}

/** Registra no jsonb um arquivo que o navegador acabou de subir para o bucket. */
export async function registrarEvidencia(
  execucaoId: string,
  etapa: string,
  arquivo: { caminho: string; nome: string; tamanho: number },
  updatedAtVisto: string | null,
): Promise<EvidenciasResult> {
  const s = await sessao(PERFIS_QUE_APONTAM, 'anexar evidência')
  if (!s.ok) return s
  if (!isEtapa(etapa)) return { ok: false, error: 'Etapa inválida' }

  const lida = await lerLinha(s.supabase, execucaoId)
  if (!lida.ok) return lida
  const obraId = (lida.linha.item as { obra_id: string } | null)?.obra_id
  if (lida.linha.empresa_id !== s.empresaId || !obraId) return { ok: false, error: 'Execução não encontrada' }

  const destino = { empresaId: s.empresaId, obraId, execucaoId, etapa }
  if (!caminhoEhDaEvidencia(arquivo.caminho, destino)) {
    return { ok: false, error: 'Arquivo fora da pasta de evidências desta etapa' }
  }
  const tipo = tipoDaEvidencia({ name: arquivo.caminho, size: 1 })
  if (!tipo) return { ok: false, error: 'Tipo de arquivo não aceito' }

  // O arquivo tem de existir: sem isto, dava para registrar um path inventado.
  const { error: naoExiste } = await s.supabase.storage.from(BUCKET_EVIDENCIAS).createSignedUrl(arquivo.caminho, 60)
  if (naoExiste) return { ok: false, error: 'Arquivo não encontrado no armazenamento' }

  const nova: Evidencia = {
    nome: String(arquivo.nome ?? '').slice(0, 255) || arquivo.caminho.split('/').pop()!,
    path: arquivo.caminho,
    tipo,
    tamanho: Number.isFinite(arquivo.tamanho) && arquivo.tamanho > 0 ? Math.round(arquivo.tamanho) : 0,
    uploaded_at: new Date().toISOString(),
    uploaded_by: s.userId,
    etapa,
  }
  return gravarEvidencias(s.supabase, execucaoId, updatedAtVisto, (atuais) =>
    atuais.some((e) => e.path === nova.path)
      ? { ok: false, error: 'Este arquivo já está registrado' }
      : { ok: true, lista: [...atuais, nova] },
  )
}

/** Exclui do bucket e do jsonb. Admin, ou quem enviou (a policy de delete do bucket). */
export async function excluirEvidencia(
  execucaoId: string,
  path: string,
  updatedAtVisto: string | null,
): Promise<EvidenciasResult> {
  const s = await sessao(PERFIS_QUE_APONTAM, 'excluir evidência')
  if (!s.ok) return s

  const lida = await lerLinha(s.supabase, execucaoId)
  if (!lida.ok) return lida
  // Confere antes de tocar no Storage: o path vem do navegador.
  const permitido = autorizarExclusaoDeAnexo(lerEvidencias(lida.linha.evidencias), path, {
    perfil: s.perfil,
    userId: s.userId,
  })
  if (!permitido.ok) return permitido

  const { data: removidos, error: rmErr } = await s.supabase.storage.from(BUCKET_EVIDENCIAS).remove([path])
  if (rmErr) return { ok: false, error: rmErr.message }
  if (!removeuDoStorage(removidos)) return { ok: false, error: 'O armazenamento recusou a exclusão do arquivo' }

  return gravarEvidencias(s.supabase, execucaoId, updatedAtVisto, (atuais) => ({
    ok: true,
    lista: atuais.filter((e) => e.path !== path),
  }))
}

/** URLs assinadas (10 min) das evidências de uma execução, para miniatura e visualização. */
export async function urlsDasEvidencias(
  execucaoId: string,
): Promise<{ ok: true; urls: Record<string, string> } | { ok: false; error: string }> {
  const s = await sessao(PERFIS_QUE_VEEM, 'ver evidências')
  if (!s.ok) return s
  const lida = await lerLinha(s.supabase, execucaoId)
  if (!lida.ok) return lida
  const paths = lerEvidencias(lida.linha.evidencias).map((e) => e.path)
  if (paths.length === 0) return { ok: true, urls: {} }
  const { data, error } = await s.supabase.storage.from(BUCKET_EVIDENCIAS).createSignedUrls(paths, 60 * 10)
  if (error) return { ok: false, error: error.message }
  const urls: Record<string, string> = {}
  for (const d of data ?? []) if (d.path && d.signedUrl) urls[d.path] = d.signedUrl
  return { ok: true, urls }
}
