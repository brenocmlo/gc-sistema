import Link from 'next/link'

/**
 * URL que não existe (13.4). Fica fora do shell do app: o layout raiz não sabe
 * quem está logado. O link leva ao início, e o middleware manda ao login quem
 * estiver sem sessão.
 */
export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 p-6" data-tela="nao-encontrado">
      <div className="max-w-sm text-center">
        <p className="text-5xl font-semibold text-gray-300 mb-4">404</p>
        <h1 className="text-gray-900 font-medium mb-1">Página não encontrada</h1>
        <p className="text-sm text-gray-500 mb-6">O endereço está errado ou a página não existe mais.</p>
        <Link href="/" className="inline-flex bg-gray-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-800 transition-colors">
          Voltar ao início
        </Link>
      </div>
    </main>
  )
}
