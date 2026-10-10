/**
 * URL no mesmo host em que o pedido chegou. `request.nextUrl` pode trazer outro
 * host (no next dev, `localhost` para um pedido feito em `127.0.0.1`; atrás de
 * proxy, o interno): o redirect cruzava de host e os cookies de sessão
 * gravados na resposta não iam junto (13.1, rota /convite).
 */
export function urlNoMesmoHost(
  headers: { get(nome: string): string | null },
  urlDoPedido: string,
  caminho: string,
): URL {
  const host = headers.get('x-forwarded-host') ?? headers.get('host')
  const proto = headers.get('x-forwarded-proto') ?? new URL(urlDoPedido).protocol.replace(':', '')
  return new URL(caminho, host ? `${proto}://${host}` : urlDoPedido)
}
