'use client'

import { useEffect, type ReactNode } from 'react'

type ModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
  /** Botões do rodapé. Se o body já tiver seus próprios botões (ex: form), deixe vazio. */
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  /** Se false, clique fora e ESC não fecham (usar durante loading). Default true. */
  dismissible?: boolean
  /**
   * Abaixo de `sm`, ocupa a tela inteira, sem margem nem borda arredondada
   * (8.2, painel de apontamento no celular). Os demais modais continuam cartão.
   */
  telaCheiaNoCelular?: boolean
}

const SIZE_CLASS: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
}

/**
 * Modal genérico — overlay escurecido, card branco centralizado, fecha no
 * ESC e click no overlay (exceto se dismissible=false).
 */
export default function Modal({
  open,
  onOpenChange,
  title,
  children,
  footer,
  size = 'sm',
  dismissible = true,
  telaCheiaNoCelular = false,
}: ModalProps) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && dismissible) onOpenChange(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, dismissible, onOpenChange])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className={`fixed inset-0 z-50 flex justify-center bg-black/40 overflow-y-auto ${
        // items-start + my-auto no cartão, e não items-center: com items-center,
        // o cartão mais alto que a tela vaza para cima, numa área que não rola
        // (o painel de apontamento passou disso com as evidências do 8.1).
        telaCheiaNoCelular ? 'items-stretch sm:items-start sm:px-4 sm:py-8' : 'items-start px-4 py-8'
      }`}
      onClick={() => dismissible && onOpenChange(false)}
    >
      <div
        className={`bg-white shadow-xl w-full ${SIZE_CLASS[size]} ${
          telaCheiaNoCelular ? 'min-h-full sm:min-h-0 sm:h-auto sm:my-auto sm:rounded-lg' : 'my-auto rounded-lg'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={telaCheiaNoCelular ? 'px-4 sm:px-6 pt-5 sm:pt-6' : 'px-6 pt-6'}>
          <h2
            id="modal-title"
            className="text-lg font-semibold text-gray-900"
          >
            {title}
          </h2>
        </div>
        <div className={telaCheiaNoCelular ? 'px-4 sm:px-6 py-4' : 'px-6 py-4'}>{children}</div>
        {footer && (
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3 rounded-b-lg">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
