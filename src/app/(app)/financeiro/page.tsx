import { redirect } from 'next/navigation'

// O financeiro começa pela visão geral (12.2). NFs (sprint 9), pagamentos
// (sprint 10) e acordos (sprint 11) são irmãs de /financeiro/visao-geral.
export default function FinanceiroPage() {
  redirect('/financeiro/visao-geral')
}
