// Mensagens que o próprio gc-sistema manda pelo bot do Telegram (Breno,
// 07/10), sem passar pelo n8n:
//   1. a quem enviou o PDF, quando a equipe resolve o documento na tela;
//   2. ao grupo de admin, quando a automação inteira para — inclusive pelo
//      limite de execuções do n8n, quando o n8n não roda nada e não poderia
//      avisar ele mesmo.
// Sem TELEGRAM_BOT_TOKEN no ambiente, nada é enviado e nada quebra.
//
// Os textos e as regras (quem recebe, quando repetir o alerta) são puros e
// testados; o envio é um fetch na API do Telegram.
import type { ErroDescrito } from './automacao.ts'

/** Mesmo grupo do nó 'Preparar envio' do n8n — mudou o grupo, mude nos dois. */
export const ADMIN_CHAT_ID_PADRAO = '-5521155438'

/** Chat do Telegram é número (grupo é negativo). Documento de teste usa texto, e não recebe nada. */
export function chatIdValido(v: unknown): v is string {
  return typeof v === 'string' && /^-?\d{5,20}$/.test(v)
}

export type Resolucao =
  | { acao: 'aceito' }
  | { acao: 'recusado'; motivo: string }
  | { acao: 'vinculado'; destino: 'proposta' | 'contrato'; numeroDestino: string | null }
  | { acao: 'descartado'; motivo: string }

/** O que quem mandou o PDF lê quando a equipe resolve o documento. */
export function avisoDeResolucao(doc: { tipo: 'proposta' | 'contrato'; numero: string | null }, r: Resolucao): string {
  const oDoc = doc.tipo === 'contrato' ? 'o contrato' : 'a proposta'
  const seu = doc.tipo === 'contrato' ? 'Seu contrato' : 'Sua proposta'
  const num = doc.numero ? ` ${doc.numero}` : ''
  switch (r.acao) {
    case 'aceito':
      return `${seu}${num} foi conferid${doc.tipo === 'contrato' ? 'o' : 'a'} pela equipe e está confirmad${doc.tipo === 'contrato' ? 'o' : 'a'} no sistema.`
    case 'recusado':
      return `A equipe conferiu ${oDoc}${num} e o registro automático não foi aceito: ${r.motivo}. O documento voltou para revisão; se precisar, a equipe entra em contato.`
    case 'vinculado': {
      const alvo = r.destino === 'contrato' ? 'ao contrato' : 'à proposta'
      return `Seu documento${num} foi registrado pela equipe, ligado ${alvo}${r.numeroDestino ? ` ${r.numeroDestino}` : ''}.`
    }
    case 'descartado':
      return `Seu documento${num} foi encerrado pela equipe sem registro no sistema: ${r.motivo}.`
  }
}

/** Alerta ao grupo de admin, com a explicação de descreverErro. */
export function alertaDeAutomacaoParada(erro: ErroDescrito): string {
  return [`[AUTOMAÇÃO PARADA] ${erro.titulo}`, erro.explicacao, `O que fazer: ${erro.oQueFazer}`].join('\n')
}

/** Janela em que o mesmo erro não é avisado de novo: um alerta por causa, não por documento. */
export const JANELA_ALERTA_HORAS = 6

export function deveAlertar(
  alertasRecentes: { detalhe: string | null; criado_em: string }[],
  codigo: string,
  agora: Date = new Date(),
  janelaHoras = JANELA_ALERTA_HORAS,
): boolean {
  const limite = agora.getTime() - janelaHoras * 3600 * 1000
  return !alertasRecentes.some((a) => a.detalhe === codigo && new Date(a.criado_em).getTime() >= limite)
}

export type ResultadoEnvio = { ok: true } | { ok: false; error: string; semConfiguracao?: boolean }

/** Corpo do sendMessage. Com responderA, responde em citação e não falha se a mensagem sumiu. */
export function corpoDoEnvio(chatId: string, texto: string, responderA?: number | null): Record<string, unknown> {
  const corpo: Record<string, unknown> = { chat_id: chatId, text: texto.slice(0, 4000) }
  if (typeof responderA === 'number' && Number.isFinite(responderA) && responderA > 0) {
    corpo.reply_parameters = { message_id: responderA, allow_sending_without_reply: true }
  }
  return corpo
}

/** Manda uma mensagem pelo bot. Nunca lança: quem chama decide se a falha vira aviso. */
export async function enviarTelegram(chatId: string, texto: string, responderA?: number | null): Promise<ResultadoEnvio> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return { ok: false, error: 'TELEGRAM_BOT_TOKEN não configurado', semConfiguracao: true }
  if (!chatIdValido(chatId)) return { ok: false, error: 'chat do Telegram inválido' }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpoDoEnvio(chatId, texto, responderA)),
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) return { ok: true }
    const corpo = (await res.json().catch(() => null)) as { description?: string } | null
    return { ok: false, error: `o Telegram respondeu ${res.status}${corpo?.description ? `: ${corpo.description}` : ''}` }
  } catch (e) {
    return { ok: false, error: `o Telegram não respondeu (${e instanceof Error ? e.message : 'erro'})` }
  }
}
