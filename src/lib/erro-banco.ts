/**
 * Erro do banco, do PostgREST ou do Storage em linguagem de usuário (13.4).
 *
 * Os tradutores de cada domínio (`mensagemDeErroNf`, `mensagemDeErroContrato`…)
 * conhecem as constraints deles pelo nome e devolvem a frase certa. O que eles
 * não conhecem cai aqui: a família do erro (permissão, duplicado, registro
 * ligado, campo obrigatório, tempo, conexão) vira uma frase genérica, e o que
 * já é frase nossa (exceção dos triggers, em português) passa como está.
 *
 * A mensagem crua continua na auditoria (13.2, etapa B): a tela simplifica, o
 * log guarda o detalhe.
 */

/** Aceita a string ou o objeto de erro do supabase-js (`{ message, code }`). */
export function mensagemDeErroBanco(erro: string | { message?: string | null; code?: string | null } | null | undefined): string {
  const raw = typeof erro === 'string' ? erro : (erro?.message ?? '')
  const codigo = typeof erro === 'string' ? '' : (erro?.code ?? '')
  const m = raw.toLowerCase()

  if (!raw.trim()) return GENERICA
  if (codigo === '42501' || m.includes('row-level security') || m.includes('permission denied')) {
    return 'Você não tem permissão para fazer isso.'
  }
  if (codigo === '23505' || m.includes('duplicate key value')) return 'Já existe um registro com esses dados.'
  if (codigo === '23503' || m.includes('violates foreign key constraint')) {
    return m.includes('update or delete on table') || m.includes('is still referenced')
      ? 'Não dá para excluir: há outros registros ligados a este.'
      : 'Um registro ligado a este não existe mais. Recarregue a página e tente de novo.'
  }
  if (codigo === '23502' || m.includes('null value in column')) return 'Falta preencher um campo obrigatório.'
  if (codigo === '23514' || m.includes('violates check constraint')) return 'Algum valor está fora do permitido. Confira os campos.'
  if (codigo === '22P02' || m.includes('invalid input syntax')) return 'Algum valor está num formato inválido.'
  if (codigo === '22001' || m.includes('value too long')) return 'Algum texto passou do tamanho máximo.'
  if (codigo === '40P01' || m.includes('deadlock detected') || codigo === '40001') {
    return 'Outra pessoa mexeu nisso ao mesmo tempo. Tente de novo.'
  }
  if (codigo === '57014' || m.includes('statement timeout') || m.includes('canceling statement')) {
    return 'A operação demorou demais e foi interrompida. Tente de novo.'
  }
  if (m.includes('jwt expired') || m.includes('auth session missing') || m.includes('invalid jwt')) {
    return 'Sua sessão expirou. Entre de novo.'
  }
  if (/fetch failed|failed to fetch|networkerror|econnreset|etimedout|enotfound|socket hang up/.test(m)) {
    return 'Sem conexão com o servidor. Confira a internet e tente de novo.'
  }
  // Storage
  if (m.includes('the resource already exists')) return 'Já existe um arquivo com esse nome.'
  if (m.includes('payload too large') || m.includes('exceeded the maximum allowed size')) return 'O arquivo passa do tamanho máximo.'
  if (m.includes('mime type') && m.includes('not supported')) return 'Esse tipo de arquivo não é aceito.'
  if (m.includes('object not found') || m.includes('bucket not found')) return 'Arquivo não encontrado.'

  // Mensagem de sistema em inglês que nenhuma regra pegou: não mostra o cru.
  if (PARECE_CRU.test(raw)) return GENERICA
  // O resto é frase nossa (exceção de trigger, validação de action): passa.
  return raw
}

const GENERICA = 'Não foi possível concluir. Tente de novo; se continuar, avise o administrador.'

const PARECE_CRU =
  /\b(violates|relation|column|syntax|function|operator|constraint|does not exist|could not|failed|error|invalid|unexpected|internal server|timeout|undefined|null)\b/i

/**
 * Resposta de erro de uma rota de API (exportação, relatório) em linguagem de
 * usuário. O corpo costuma ser `{ error }`: 400 traz frase nossa ("Escolha uma
 * obra"), 500 traz o erro do banco. 401 e 403 viram sessão e perfil.
 */
export function mensagemDeErroHttp(status: number, corpo: string): string {
  let msg = ''
  try {
    const j = JSON.parse(corpo) as { error?: unknown }
    if (typeof j?.error === 'string') msg = j.error
  } catch {
    msg = corpo.trim().startsWith('<') ? '' : corpo.trim().slice(0, 300)
  }
  if (status === 401) return 'Sua sessão expirou. Entre de novo.'
  if (status === 403) return 'Seu perfil não tem acesso a isto.'
  if (status === 404) return 'Não encontrado. Recarregue a página e tente de novo.'
  if (status === 400 && msg && !PARECE_CRU.test(msg)) return msg
  return mensagemDeErroBanco(msg)
}
