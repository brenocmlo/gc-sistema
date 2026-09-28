import { ArrowLeft, ExternalLink, FileText } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import AndamentoAutomacao from '@/components/AndamentoAutomacao'
import ConferenciaAutomacao from '@/components/ConferenciaAutomacao'
import DetailField from '@/components/DetailField'
import {
  aguardaConferencia,
  caminhoDoArquivo,
  destinoDoDocumento,
  itensLidos,
  podeRevisar,
  resumoDoDocumento,
  rotuloOrigem,
  rotuloTipo,
  type DocumentoListItem,
} from '@/lib/documentos'
import type { EventoAutomacao } from '@/lib/automacao'
import { formatCurrency, formatDateTime } from '@/lib/format'
import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'

import StatusDocumento from '../status-documento'

import RevisaoPanel from './revisao-panel'

// Detalhe de um documento recebido: o que a leitura achou, o PDF, e para onde
// ele levou (proposta ou contrato). É aqui que a revisão humana começa.
export default async function DocumentoPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('documentos_processamento')
    .select(
      'id, status, tipo_documento, canal, obra_id, created_at, motivo_revisao, proposta_criada_id, contrato_criado_id, dados_extraidos, conferencia, arquivo_url, etapa, etapa_detalhe, etapa_em, obra:obras(codigo_obra, nome)',
    )
    .eq('id', params.id)
    .maybeSingle()

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700">
        Erro ao carregar o documento: {error.message}
      </div>
    )
  }
  if (!data) notFound()

  const doc = data as DocumentoListItem & {
    arquivo_url: string
    etapa: string | null
    etapa_detalhe: string | null
    etapa_em: string | null
  }

  // Andamento: o trigger do banco grava um evento a cada mudança de etapa; o
  // n8n grava os erros que não chegam a mudar o documento.
  const { data: eventosData } = await supabase
    .from('automacao_eventos')
    .select('id, documento_id, etapa, nivel, mensagem, detalhe, origem, criado_em')
    .eq('documento_id', doc.id)
    .order('criado_em', { ascending: true })
  const eventos = (eventosData ?? []) as EventoAutomacao[]
  const resumo = resumoDoDocumento(doc.dados_extraidos)
  const itens = itensLidos(doc.dados_extraidos)
  const destino = destinoDoDocumento(doc)

  // A URL guardada pelo bot expira; gera uma nova, com a sessão de quem abriu
  // (o bucket só deixa ler arquivo da própria empresa).
  const caminho = caminhoDoArquivo(doc.arquivo_url)
  const { data: assinada } = caminho
    ? await supabase.storage.from('documentos-processamento').createSignedUrl(caminho, 60 * 10)
    : { data: null }

  // Painel de revisão: só para quem pode escrever (admin e comercial) e só
  // enquanto o documento pede ação.
  const profile = await getCurrentProfile()
  const podeEditar = profile?.perfil === 'admin' || profile?.perfil === 'comercial'
  let revisao: { obras: { value: string; label: string }[]; propostas: { value: string; label: string }[]; contratos: { value: string; label: string }[] } | null = null
  if (podeEditar && podeRevisar(doc.status)) {
    const obraFiltro = doc.obra_id
    const [{ data: obras }, { data: props }, { data: ctrs }] = await Promise.all([
      supabase.from('obras').select('id, codigo_obra, nome').order('codigo_obra', { ascending: false }),
      obraFiltro
        ? supabase.from('propostas').select('id, numero').eq('obra_id', obraFiltro).order('numero')
        : supabase.from('propostas').select('id, numero').order('numero'),
      obraFiltro
        ? supabase.from('contratos').select('id, numero').eq('obra_id', obraFiltro).order('numero')
        : supabase.from('contratos').select('id, numero').order('numero'),
    ])
    revisao = {
      obras: (obras ?? []).map((o) => ({ value: o.id, label: `${o.codigo_obra} — ${o.nome}` })),
      propostas: (props ?? []).map((x) => ({ value: x.id, label: x.numero })),
      contratos: (ctrs ?? []).map((x) => ({ value: x.id, label: x.numero })),
    }
  }

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <Link href="/documentos" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft size={14} /> Documentos
      </Link>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              {rotuloTipo(doc.tipo_documento)} {resumo.numero ?? 'sem número lido'}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Recebido {formatDateTime(doc.created_at)} · {rotuloOrigem(doc.canal)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusDocumento status={doc.status} conferencia={doc.conferencia} />
            {destino && (
              <Link
                href={destino.href}
                className="inline-flex items-center gap-1.5 bg-gray-900 text-white px-3 py-1.5 rounded-md text-sm font-medium hover:bg-gray-800"
              >
                {destino.rotulo}
              </Link>
            )}
          </div>
        </div>

        {doc.motivo_revisao && (
          <div className="bg-orange-50 border border-orange-200 rounded-md p-3 text-sm text-orange-800">
            <span className="font-medium">Motivo: </span>
            {doc.motivo_revisao}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <DetailField label="Obra" value={doc.obra ? `${doc.obra.codigo_obra} — ${doc.obra.nome}` : null} />
          <DetailField label="Cliente lido" value={resumo.cliente} />
          <DetailField label="Valor lido" value={resumo.valor === null ? null : formatCurrency(resumo.valor)} />
        </div>

        <div className="flex items-center gap-3 text-sm">
          {assinada?.signedUrl ? (
            <a
              href={assinada.signedUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-gray-900 underline underline-offset-2"
            >
              <FileText size={14} /> Abrir o PDF recebido <ExternalLink size={12} />
            </a>
          ) : (
            <span className="text-gray-500">PDF indisponível</span>
          )}
          {resumo.extrator && (
            <span className="text-gray-500">· lido por {resumo.extrator === 'groq' ? 'Groq (reserva)' : 'Gemini'}</span>
          )}
        </div>
      </div>

      <AndamentoAutomacao etapa={doc.etapa} etapaDetalhe={doc.etapa_detalhe} etapaEm={doc.etapa_em} eventos={eventos} />

      {aguardaConferencia(doc) && (
        <ConferenciaAutomacao
          documentoId={doc.id}
          oQue={doc.contrato_criado_id ? 'contrato' : 'proposta'}
          podeAceitar={podeEditar}
          podeRecusar={profile?.perfil === 'admin'}
          mostrarLinkDocumento={false}
        />
      )}

      {revisao && (
        <RevisaoPanel
          documentoId={doc.id}
          obraAtual={doc.obra_id}
          obraOptions={revisao.obras}
          propostaOptions={revisao.propostas}
          contratoOptions={revisao.contratos}
        />
      )}

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Itens lidos ({itens.length})</h2>
          {resumo.itensConfiaveis === false && (
            <span className="text-xs text-orange-700">Leitura não confiável: os itens não foram gravados</span>
          )}
        </div>
        {itens.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500">A leitura não encontrou itens.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-2">Item</th>
                  <th className="px-4 py-2">Descrição</th>
                  <th className="px-4 py-2 text-right">Qtd.</th>
                  <th className="px-4 py-2">Un.</th>
                  <th className="px-4 py-2 text-right">Unitário</th>
                  <th className="px-4 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {itens.map((it, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 tabular-nums">{it.numero ?? '—'}</td>
                    <td className="px-4 py-2">
                      {it.descricao ?? '—'}
                      {(it.tipo || it.localizacao) && (
                        <span className="block text-xs text-gray-500">{[it.tipo, it.localizacao].filter(Boolean).join(' · ')}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{it.quantidade ?? '—'}</td>
                    <td className="px-4 py-2">{it.unidade ?? '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{it.valor_unitario === null ? '—' : formatCurrency(it.valor_unitario)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{it.valor_total === null ? '—' : formatCurrency(it.valor_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
