/**
 * Esqueleto das listagens (13.4), mostrado pelo `loading.tsx` enquanto a page
 * busca os dados: o título, a barra de filtros e as linhas da tabela no lugar
 * em que vão aparecer, para a tela não pular quando o conteúdo chega.
 */
export default function ListagemSkeleton({ linhas = 8, filtros = 3 }: { linhas?: number; filtros?: number }) {
  return (
    <div className="space-y-6 animate-pulse" data-skeleton="listagem" aria-busy="true" aria-label="Carregando">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-7 w-48 bg-gray-200 rounded" />
          <div className="h-4 w-72 max-w-full bg-gray-100 rounded" />
        </div>
        <div className="h-9 w-32 bg-gray-200 rounded-md shrink-0" />
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="h-9 flex-1 bg-gray-100 rounded-md" />
        {Array.from({ length: filtros }, (_, i) => (
          <div key={i} className="h-9 sm:w-40 bg-gray-100 rounded-md" />
        ))}
      </div>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="h-11 bg-gray-50 border-b border-gray-200" />
        {Array.from({ length: linhas }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-gray-100 last:border-0">
            <div className="h-4 w-24 bg-gray-100 rounded" />
            <div className="h-4 flex-1 bg-gray-100 rounded" />
            <div className="h-4 w-20 bg-gray-100 rounded hidden sm:block" />
            <div className="h-4 w-16 bg-gray-100 rounded hidden sm:block" />
          </div>
        ))}
      </div>
    </div>
  )
}
