const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

export function formatCurrency(
  value: number | string | null | undefined,
): string {
  if (value === null || value === undefined) return '—'
  const num = typeof value === 'string' ? Number(value) : value
  if (Number.isNaN(num)) return '—'
  return currencyFormatter.format(num)
}

// timeZone: 'UTC' pra evitar drift quando o valor é um date puro ('YYYY-MM-DD')
// que o JS interpreta como UTC midnight e que no fuso BR vira dia anterior.
const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
})

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return dateFormatter.format(date)
}

// Data e hora de um evento (auditoria). Diferente de formatDate, que lê
// colunas `date` e por isso fixa UTC, aqui é timestamptz: mostra no fuso de
// quem opera o sistema.
const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'America/Sao_Paulo',
})

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return dateTimeFormatter.format(date)
}
