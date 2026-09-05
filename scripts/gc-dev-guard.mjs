/**
 * Trava de ambiente: nada deste repositório roda contra gc-prod.
 *
 * Regra do projeto (ver CLAUDE.md): trabalhamos **só em gc-dev**. Não é uma
 * preferência, é o que separa "errar num banco de teste" de "errar no banco do
 * cliente" — e as duas credenciais moram no mesmo `.env.local`, a um ctrl+C de
 * distância uma da outra.
 *
 * Todo script que abre conexão importa `exigirGcDev()` e morre cedo se o
 * `.env.local` estiver apontando pra outro lugar.
 */

/** Project ref do gc-dev. gc-prod é `zondscnfosubxutpshux` — e não se usa. */
export const GC_DEV_REF = 'gzbmhgnpoehormnidmgg'

export function refDoProjeto(url) {
  try {
    return new URL(url).hostname.split('.')[0]
  } catch {
    return null
  }
}

/**
 * Aborta se a URL não for a de gc-dev. Chame antes de criar qualquer client.
 * `acao` entra na mensagem só pra dizer o que foi impedido.
 */
export function exigirGcDev(url, acao = 'esta operação') {
  const ref = refDoProjeto(url)

  if (!ref) {
    console.error(`FALHA: NEXT_PUBLIC_SUPABASE_URL ausente ou inválida (${url}).`)
    process.exit(1)
  }

  if (ref !== GC_DEV_REF) {
    console.error(
      `FALHA: ${acao} só roda contra gc-dev (${GC_DEV_REF}), e o .env.local\n` +
        `  aponta pra ${ref}. Trabalhar em gc-prod está fora do escopo deste\n` +
        `  repositório — ver a regra em CLAUDE.md. Se for mesmo necessário,\n` +
        `  é decisão do Breno, feita à mão e fora destes scripts.`,
    )
    process.exit(1)
  }

  return ref
}
