import { AlertTriangle, CheckCircle2, CircleDot, XCircle } from 'lucide-react'

import {
  ETAPAS_DO_CAMINHO,
  descreverErro,
  etapaEncerrada,
  rotuloEtapa,
  type ErroDescrito,
  type EventoAutomacao,
} from '@/lib/automacao'
import { formatDateTime } from '@/lib/format'

// Em que etapa a automação está com este documento e tudo o que aconteceu com
// ele, do recebimento à gravação. Erro e aviso vêm traduzidos por
// descreverErro; o texto cru fica recolhido para quem precisar investigar.
export default function AndamentoAutomacao({
  etapa,
  etapaDetalhe,
  etapaEm,
  eventos,
}: {
  etapa: string | null
  etapaDetalhe: string | null
  etapaEm: string | null
  /** Mais antigo primeiro. */
  eventos: EventoAutomacao[]
}) {
  const vistas = new Set(eventos.map((e) => (e.etapa === 'LEITURA_RESERVA' ? 'LEITURA' : e.etapa)))
  const atual = etapa === 'LEITURA_RESERVA' ? 'LEITURA' : etapa
  const problema =
    etapa === 'ERRO' || etapa === 'REVISAO' || etapa === 'LEITURA_RESERVA' || (etapa === 'CONCLUIDO' && !!etapaDetalhe)
  const descrito = problema && etapaDetalhe ? descreverErro(etapaDetalhe) : null

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm" data-teste="andamento-automacao">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-gray-900">Andamento da automação</h2>
        <span className="text-sm text-gray-700">
          Etapa atual: <span className="font-medium">{rotuloEtapa(etapa)}</span>
          {etapaEm && <span className="text-gray-500"> · desde {formatDateTime(etapaEm)}</span>}
        </span>
      </div>

      <div className="px-4 py-3 space-y-3">
        <ol className="flex flex-wrap items-center gap-2 text-xs">
          {ETAPAS_DO_CAMINHO.map((e) => {
            const agora = e === atual
            const feita = !agora && vistas.has(e)
            return (
              <li
                key={e}
                className={`px-2 py-1 rounded-full border ${
                  agora
                    ? 'bg-gray-900 text-white border-gray-900'
                    : feita
                      ? 'bg-green-50 text-green-800 border-green-200'
                      : 'bg-gray-50 text-gray-400 border-gray-200'
                }`}
              >
                {rotuloEtapa(e)}
              </li>
            )
          })}
          {(etapa === 'ERRO' || etapa === 'REVISAO') && (
            <li
              className={`px-2 py-1 rounded-full border ${
                etapa === 'ERRO' ? 'bg-red-50 text-red-800 border-red-200' : 'bg-orange-50 text-orange-800 border-orange-200'
              }`}
            >
              {rotuloEtapa(etapa)}
            </li>
          )}
        </ol>

        {descrito && <ErroExplicado erro={descrito} bruto={etapaDetalhe} grave={etapa === 'ERRO'} />}
        {etapa && !etapaEncerrada(etapa) && (
          <p className="text-xs text-gray-500">
            A automação ainda está trabalhando neste documento; recarregue a página para ver a próxima etapa.
          </p>
        )}
      </div>

      <div className="border-t border-gray-200">
        {eventos.length === 0 ? (
          <p className="px-4 py-4 text-sm text-gray-500">
            Nenhum evento registrado. Documentos recebidos antes do log da automação (28/09) não têm andamento.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {eventos.map((ev) => (
              <li key={ev.id} className="px-4 py-2.5 text-sm flex gap-3">
                <IconeNivel nivel={ev.nivel} />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <span className="font-medium text-gray-900">{rotuloEtapa(ev.etapa)}</span>
                    <span className="text-xs text-gray-500 tabular-nums">{formatDateTime(ev.criado_em)}</span>
                  </div>
                  <p className="text-gray-600">{ev.mensagem}</p>
                  {(ev.nivel === 'erro' || ev.nivel === 'aviso') && (
                    <ErroExplicado erro={descreverErro(ev.detalhe ?? ev.mensagem)} bruto={ev.detalhe} grave={ev.nivel === 'erro'} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export function IconeNivel({ nivel }: { nivel: string }) {
  if (nivel === 'erro') return <XCircle size={16} className="text-red-600 mt-0.5 shrink-0" />
  if (nivel === 'aviso') return <AlertTriangle size={16} className="text-orange-500 mt-0.5 shrink-0" />
  if (nivel === 'info') return <CheckCircle2 size={16} className="text-green-600 mt-0.5 shrink-0" />
  return <CircleDot size={16} className="text-gray-400 mt-0.5 shrink-0" />
}

export function ErroExplicado({ erro, bruto, grave }: { erro: ErroDescrito; bruto: string | null; grave: boolean }) {
  return (
    <div
      className={`rounded-md border p-3 text-sm space-y-1 ${
        grave ? 'bg-red-50 border-red-200 text-red-800' : 'bg-orange-50 border-orange-200 text-orange-800'
      }`}
    >
      <p className="font-medium">{erro.titulo}</p>
      <p>{erro.explicacao}</p>
      <p>
        <span className="font-medium">O que fazer: </span>
        {erro.oQueFazer}
      </p>
      {bruto && (
        <details className="text-xs opacity-80">
          <summary className="cursor-pointer">Mensagem técnica</summary>
          <p className="mt-1 break-words font-mono">{bruto}</p>
        </details>
      )}
    </div>
  )
}
