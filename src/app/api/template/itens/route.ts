import { buildWorkbookResponse } from '@/lib/excel-export'
import { COLUNAS_IMPORTACAO, INSTRUCOES_TEMPLATE } from '@/lib/itens-form'
import { getCurrentProfile } from '@/lib/supabase/profile'

/**
 * Template XLSX para a importação em massa de itens (bloco 5.4).
 *
 * As colunas vêm de `COLUNAS_IMPORTACAO`, a MESMA lista que o parse e a
 * validação usam — se alguém acrescentar um campo lá, o template ganha a
 * coluna junto, e não existe a possibilidade de o arquivo que a pessoa baixa
 * ter cabeçalho diferente do que o sistema espera.
 *
 * Autenticada por sessão, como as rotas de `/api/export/*`: a rota não lê dado
 * de ninguém, mas template de importação não é conteúdo público.
 */
export async function GET() {
  const profile = await getCurrentProfile()
  if (!profile) {
    return new Response('Não autenticado', { status: 401 })
  }

  // Uma linha de exemplo, como o enunciado do bloco pede. A Observação dela
  // começa com MARCA_EXEMPLO, e é isso que faz o preview recusá-la — sem a
  // marca ela é uma linha válida e seria importada como item.
  const exemplo: Record<string, string | number | null> = {}
  for (const col of COLUNAS_IMPORTACAO) exemplo[col.chave] = col.exemplo

  return buildWorkbookResponse('itens-template.xlsx', {
    sheetName: 'Itens',
    metaRows: [...INSTRUCOES_TEMPLATE.map((linha) => [linha]), []],
    columns: COLUNAS_IMPORTACAO.map((col) => ({
      header: col.titulo,
      width: col.largura,
      value: (row: Record<string, string | number | null>) =>
        row[col.chave] ?? null,
      numFmt:
        col.chave === 'valor_unit'
          ? '#,##0.00'
          : col.chave === 'largura' || col.chave === 'altura'
            ? '#,##0.000'
            : undefined,
    })),
    rows: [exemplo],
  })
}
