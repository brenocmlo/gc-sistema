import { redirect } from 'next/navigation'

// Sprint 9: o financeiro começa pelas notas fiscais. Pagamentos (sprint 10)
// e acordos entram como irmãs de /financeiro/notas-fiscais.
export default function FinanceiroPage() {
  redirect('/financeiro/notas-fiscais')
}
