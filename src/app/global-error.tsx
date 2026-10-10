'use client'

/**
 * Último recurso (13.4): erro no próprio layout raiz, quando nem o shell do app
 * renderiza. Precisa do seu <html> e <body>, e não tem o CSS do app garantido,
 * por isso o estilo vai inline.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', margin: 0, background: '#f9fafb' }}>
        <div style={{ maxWidth: 360, textAlign: 'center', padding: 24 }}>
          <h1 style={{ fontSize: 18, fontWeight: 500, color: '#111827', margin: '0 0 8px' }}>O sistema não conseguiu abrir</h1>
          <p style={{ fontSize: 14, color: '#6b7280', margin: '0 0 20px' }}>
            Tente de novo. Se continuar, avise o administrador{error.digest ? ` com o código ${error.digest}` : ''}.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{ background: '#111827', color: '#fff', border: 0, borderRadius: 6, padding: '8px 16px', fontSize: 14, cursor: 'pointer' }}
          >
            Tentar de novo
          </button>
        </div>
      </body>
    </html>
  )
}
