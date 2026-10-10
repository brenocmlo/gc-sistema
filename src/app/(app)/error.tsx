'use client'

import { AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { useEffect } from 'react'

/**
 * Erro inesperado numa tela do app (13.4). Fica dentro do shell: o menu
 * continua lá, e "Tentar de novo" refaz só a tela. O `digest` é o código que o
 * servidor registrou; vale anotar ao avisar o administrador.
 */
export default function ErroDoApp({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-12 text-center" data-tela="erro">
      <div className="mx-auto w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mb-4">
        <AlertTriangle size={28} className="text-red-500" />
      </div>
      <h1 className="text-gray-900 font-medium mb-1">Algo deu errado ao abrir esta tela</h1>
      <p className="text-sm text-gray-500 mb-4">
        Tente de novo. Se continuar, avise o administrador{error.digest ? ` com o código ${error.digest}` : ''}.
      </p>
      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="bg-gray-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-800 transition-colors"
        >
          Tentar de novo
        </button>
        <Link href="/" className="px-4 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors">
          Voltar ao início
        </Link>
      </div>
    </div>
  )
}
