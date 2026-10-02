// O PDF que chegou pelo bot (ou pela tela) vira anexo da proposta ou do
// contrato que a automação criou — Breno, 28/09: "na parte de proposta, o pdf
// enviado pelo bot deve ficar no anexos". Antes o n8n fazia isso com 4 nós; a
// rota de ingestão faz agora, no mesmo pedido que cria o registro.
//
// A parte pura (nome, caminho, entrada do jsonb) é testada; a cópia no Storage
// recebe o cliente de fora (service role da rota).
import type { SupabaseClient } from '@supabase/supabase-js'

import { caminhoDoArquivo } from './documentos.ts'
import { buildStoragePath } from './files.ts'
import type { Anexo } from './types'

export type EntidadeDoAnexo = 'propostas' | 'contratos'

/** `{empresa}/sistema/1727_proposta-x.pdf` → `proposta-x.pdf` (tira o carimbo de tempo). */
export function nomeOriginalDoArquivo(caminho: string): string {
  const ultimo = caminho.split('/').pop() ?? ''
  const nome = ultimo.replace(/^\d{10,}_/, '')
  return nome || 'documento.pdf'
}

/** Junta o anexo novo aos que já existem sem duplicar o mesmo arquivo (reexecução do n8n). */
export function juntarAnexo(existentes: unknown, novo: Anexo): Anexo[] {
  const lista = Array.isArray(existentes) ? (existentes as Anexo[]) : []
  const jaTem = lista.some((a) => a && a.nome === novo.nome && a.tamanho === novo.tamanho)
  return jaTem ? lista : [...lista, novo]
}

export type ResultadoAnexo = { ok: true; anexo: Anexo } | { ok: false; error: string }

/**
 * Copia o PDF do bucket `documentos-processamento` para `anexos`, no formato
 * de `buildStoragePath` (o que a RLS do Storage e a aba Anexos esperam), e
 * acrescenta a entrada no jsonb `anexos` do registro. Falha não desfaz o
 * registro: quem chama transforma em aviso.
 */
export async function anexarPdfDoDocumento(
  supabase: SupabaseClient,
  args: { empresaId: string; entidade: EntidadeDoAnexo; entidadeId: string; arquivoUrl: string | null; autor: string },
): Promise<ResultadoAnexo> {
  const origem = caminhoDoArquivo(args.arquivoUrl)
  if (!origem) return { ok: false, error: 'o documento não aponta para um arquivo do bucket' }

  const { data: arquivo, error: erroBaixar } = await supabase.storage.from('documentos-processamento').download(origem)
  if (erroBaixar || !arquivo) return { ok: false, error: `não foi possível ler o PDF recebido: ${erroBaixar?.message ?? 'vazio'}` }

  const nome = nomeOriginalDoArquivo(origem)
  const destino = buildStoragePath(args.empresaId, args.entidade, args.entidadeId, nome)
  const { error: erroSubir } = await supabase.storage
    .from('anexos')
    .upload(destino, arquivo, { contentType: 'application/pdf', upsert: false })
  if (erroSubir) return { ok: false, error: `não foi possível gravar o anexo: ${erroSubir.message}` }

  const anexo: Anexo = {
    nome,
    path: destino,
    tipo: 'application/pdf',
    tamanho: arquivo.size,
    uploaded_at: new Date().toISOString(),
    uploaded_by: args.autor,
  }

  const { data: atual, error: erroLer } = await supabase.from(args.entidade).select('anexos').eq('id', args.entidadeId).single()
  const { error: erroGravar } = erroLer
    ? { error: erroLer }
    : await supabase.from(args.entidade).update({ anexos: juntarAnexo(atual?.anexos, anexo) }).eq('id', args.entidadeId)
  if (erroGravar) {
    // Sem a entrada no jsonb, o arquivo ficaria órfão no bucket.
    await supabase.storage.from('anexos').remove([destino])
    return { ok: false, error: `não foi possível registrar o anexo: ${erroGravar.message}` }
  }
  return { ok: true, anexo }
}
