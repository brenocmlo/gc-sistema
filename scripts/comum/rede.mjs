/**
 * Nova tentativa para chamadas de autenticação dos roteiros de validação.
 *
 * No fechamento da sprint 9, a conexão com o Supabase caiu duas vezes no meio
 * da camada escrita (`fetch failed` no login e no generateLink), e a rodada
 * inteira se perdeu por um pacote. Isto repete a chamada só quando o erro é de
 * REDE — resposta do Supabase (senha errada, usuário inexistente, 4xx) volta
 * na hora, sem nova tentativa, para não esconder erro real.
 *
 * Só para login e geração de sessão. As actions testadas nunca passam por
 * aqui: uma action que falha por rede tem de aparecer como falha.
 */
const ESPERAS_MS = [1000, 3000, 8000]

function eErroDeRede(erro) {
  if (!erro) return false
  const msg = String(erro.message ?? '')
  return (
    erro.name === 'AuthRetryableFetchError' ||
    erro.status === 0 ||
    /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(msg) ||
    /fetch failed|ECONNRESET|ETIMEDOUT/i.test(String(erro.cause?.code ?? erro.cause?.message ?? ''))
  )
}

/**
 * Roda `chamada` (que devolve `{ data, error }` do supabase-js) e repete até
 * 3 vezes se o erro for de rede. Devolve o último resultado.
 */
export async function comNovaTentativa(rotulo, chamada) {
  for (let i = 0; ; i++) {
    let resultado
    try {
      resultado = await chamada()
    } catch (e) {
      if (!eErroDeRede(e) || i >= ESPERAS_MS.length) throw e
      resultado = { data: null, error: e }
    }
    if (!eErroDeRede(resultado?.error) || i >= ESPERAS_MS.length) return resultado
    console.log(`  rede: ${rotulo} falhou (${resultado.error.message}); nova tentativa em ${ESPERAS_MS[i] / 1000}s`)
    await new Promise((r) => setTimeout(r, ESPERAS_MS[i]))
  }
}
