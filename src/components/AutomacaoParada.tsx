import { AlertOctagon } from 'lucide-react'
import Link from 'next/link'

import { situacaoDaAutomacao, type EventoAutomacao } from '@/lib/automacao'
import { formatDateTime } from '@/lib/format'

// Faixa vermelha no topo de /documentos quando a automação inteira parou
// (limite do n8n, token, configuração) — não só um documento.
export default function AutomacaoParada({ eventos }: { eventos: EventoAutomacao[] }) {
  const s = situacaoDaAutomacao(eventos)
  if (!s.parada) return null
  return (
    <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-800 flex gap-3" data-teste="automacao-parada">
      <AlertOctagon size={18} className="shrink-0 mt-0.5" />
      <div className="space-y-1">
        <p className="font-semibold">A automação está parada: {s.erro.titulo}</p>
        <p>{s.erro.explicacao}</p>
        <p>
          <span className="font-medium">O que fazer: </span>
          {s.erro.oQueFazer}
        </p>
        <p className="text-xs">
          Desde {formatDateTime(s.desde)} ·{' '}
          <Link href="/documentos/log" className="underline underline-offset-2">
            ver o log da automação
          </Link>
        </p>
      </div>
    </div>
  )
}
