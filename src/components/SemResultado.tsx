import Link from 'next/link'

type SemResultadoProps = {
  /** Ex: "Nenhum contrato encontrado com esses filtros." */
  texto: string
  /** A listagem sem filtro (na execução, a mesma obra sem os filtros). */
  limparHref: string
}

/**
 * Listagem vazia POR CAUSA do filtro (13.4). O vazio sem filtro é o
 * EmptyState, com o convite a cadastrar; aqui o caminho de volta é tirar os
 * filtros, então o atalho fica ao lado da frase.
 */
export default function SemResultado({ texto, limparHref }: SemResultadoProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-500">
      <p>{texto}</p>
      <Link href={limparHref} className="inline-block mt-2 text-gray-900 underline underline-offset-2 hover:text-gray-700">
        Limpar filtros
      </Link>
    </div>
  )
}
