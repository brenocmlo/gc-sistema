import { SearchX } from 'lucide-react'
import Link from 'next/link'

type NaoEncontradoProps = {
  /** Ex: "Proposta não encontrada". */
  titulo: string
  /** Para onde voltar: a listagem da entidade. */
  voltarHref: string
  voltarLabel: string
}

/**
 * Tela de "não encontrado" dos detalhes (13.4): o registro foi excluído, o
 * link é velho ou é de outra empresa (a RLS esconde, e para quem pergunta é o
 * mesmo que não existir). Vale para o detalhe e para a edição abaixo dele.
 */
export default function NaoEncontrado({ titulo, voltarHref, voltarLabel }: NaoEncontradoProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-12 text-center" data-tela="nao-encontrado">
      <div className="mx-auto w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
        <SearchX size={28} className="text-gray-400" />
      </div>
      <h1 className="text-gray-900 font-medium mb-1">{titulo}</h1>
      <p className="text-sm text-gray-500 mb-4">
        Pode ter sido excluído, ou o link está desatualizado.
      </p>
      <Link
        href={voltarHref}
        className="inline-flex items-center gap-2 bg-gray-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-800 transition-colors"
      >
        {voltarLabel}
      </Link>
    </div>
  )
}
