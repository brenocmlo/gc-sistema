import {
  camposAlterados,
  formatarValorAuditoria,
  linhaDoEvento,
  resumoEvento,
  type EventoAuditoria,
} from '@/lib/auditoria'

/**
 * Resumo na linha, detalhe no <details>: abre sem JS e sem ir pra outra tela.
 * Update mostra o diff campo a campo; criação e exclusão, a linha inteira.
 * Usado pela tabela do /logs e pela aba Histórico das telas de detalhe (13.2).
 */
export default function EventoDetalhe({
  evento,
}: {
  evento: Pick<EventoAuditoria, 'acao' | 'mensagem' | 'detalhe' | 'resultado' | 'registro_id'>
}) {
  const campos = camposAlterados(evento.detalhe)
  const linha = linhaDoEvento(evento.detalhe)
  const resumo = resumoEvento(evento)
  const temDetalhe = campos.length > 0 || linha !== null || evento.detalhe != null

  if (!temDetalhe) {
    return <span className={evento.resultado === 'erro' ? 'text-red-700' : ''}>{resumo}</span>
  }

  return (
    <details className="group">
      <summary
        className={`cursor-pointer select-none ${evento.resultado === 'erro' ? 'text-red-700' : ''}`}
      >
        {resumo}
      </summary>
      <div className="mt-2 text-xs">
        {campos.length > 0 ? (
          <table className="w-full border border-gray-200 rounded">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-2 py-1 text-left font-medium">Campo</th>
                <th className="px-2 py-1 text-left font-medium">Antes</th>
                <th className="px-2 py-1 text-left font-medium">Depois</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {campos.map((c) => (
                <tr key={c.campo}>
                  <td className="px-2 py-1 font-mono text-gray-700">{c.campo}</td>
                  <td className="px-2 py-1 text-gray-500 break-all">{formatarValorAuditoria(c.de)}</td>
                  <td className="px-2 py-1 text-gray-900 break-all">{formatarValorAuditoria(c.para)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : linha ? (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
            {Object.entries(linha).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-mono text-gray-500">{k}</dt>
                <dd className="text-gray-900 break-all">{formatarValorAuditoria(v)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <pre className="whitespace-pre-wrap break-all text-gray-700">
            {JSON.stringify(evento.detalhe, null, 2)}
          </pre>
        )}
        {evento.registro_id && (
          <p className="mt-1 text-gray-400 font-mono">id {evento.registro_id}</p>
        )}
      </div>
    </details>
  )
}
