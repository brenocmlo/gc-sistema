/**
 * Auditoria (bloco 13.2): rótulos, filtros e leitura do `detalhe` dos eventos
 * de `auditoria_eventos`, para a tela /logs.
 *
 * Quem grava não é este arquivo: o trigger `auditar_mudanca` registra toda
 * escrita que chegou ao banco, e a RPC `registrar_evento` registra o que o
 * trigger não vê (o erro, que sofre rollback junto com a escrita). Ver a
 * migration `20260923130000_auditoria_eventos.sql`.
 *
 * `detalhe` é jsonb e chega aqui como `unknown`: o formato é o que o trigger
 * escreve, mas a RPC aceita o que quem chamou mandar. Toda leitura tolera
 * formato inesperado em vez de quebrar a tela.
 */

export type OrigemEvento = 'sistema' | 'automacao' | 'banco'
export type ResultadoEvento = 'sucesso' | 'erro'

/** Linha da listagem, com o select da page. */
export type EventoAuditoria = {
  id: number
  em: string
  origem: OrigemEvento
  entidade: string
  registro_id: string | null
  /** Como a tela chama o registro (número, código, nome), gravado no evento. */
  referencia: string | null
  acao: string
  resultado: ResultadoEvento
  mensagem: string | null
  autor_id: string | null
  autor_descricao: string | null
  detalhe: unknown
}

export const ORIGEM_LABELS: Record<OrigemEvento, string> = {
  sistema: 'Sistema',
  automacao: 'Automação',
  banco: 'Banco (SQL direto)',
}

export const RESULTADO_LABELS: Record<ResultadoEvento, string> = {
  sucesso: 'Sucesso',
  erro: 'Erro',
}

/** As tabelas com trigger de auditoria, na ordem do menu. */
export const ENTIDADE_LABELS: Record<string, string> = {
  clientes: 'Cliente',
  orcamentos: 'Orçamento',
  obras: 'Obra',
  propostas: 'Proposta',
  itens: 'Item',
  contratos: 'Contrato',
  execucao: 'Execução',
  notas_fiscais: 'Nota fiscal',
  pagamentos: 'Pagamento',
  acordos_pagamento: 'Acordo de pagamento',
  acordo_parcelas: 'Parcela de acordo',
  fd: 'Faturamento direto',
  documentos_processamento: 'Documento da automação',
  contatos_whatsapp: 'Contato da automação',
  profiles: 'Usuário',
}

/** As quatro do trigger. Evento da RPC pode trazer outra — ver labelAcao. */
export const ACAO_LABELS: Record<string, string> = {
  criar: 'Criação',
  editar: 'Edição',
  status: 'Mudança de status',
  excluir: 'Exclusão',
}

const AUTOR_DESCRICAO_LABELS: Record<string, string> = {
  service_role: 'Automação (chave de serviço)',
  postgres: 'Banco (SQL direto)',
}

function opcoes(labels: Record<string, string>) {
  return Object.entries(labels).map(([value, label]) => ({ value, label }))
}

export const ORIGEM_OPTIONS = opcoes(ORIGEM_LABELS)
export const RESULTADO_OPTIONS = opcoes(RESULTADO_LABELS)
export const ENTIDADE_OPTIONS = opcoes(ENTIDADE_LABELS)
export const ACAO_OPTIONS = opcoes(ACAO_LABELS)

// Querystring é input externo: filtro desconhecido é ignorado, não repassado
// ao banco.
export function isOrigemEvento(v: string): v is OrigemEvento {
  return v in ORIGEM_LABELS
}

export function isResultadoEvento(v: string): v is ResultadoEvento {
  return v in RESULTADO_LABELS
}

export function isEntidadeAuditada(v: string): boolean {
  return Object.prototype.hasOwnProperty.call(ENTIDADE_LABELS, v)
}

export function isAcaoDoTrigger(v: string): boolean {
  return Object.prototype.hasOwnProperty.call(ACAO_LABELS, v)
}

/** Entidade fora da lista (evento da RPC) aparece crua, não some. */
export function labelEntidade(entidade: string): string {
  return ENTIDADE_LABELS[entidade] ?? entidade
}

export function labelAcao(acao: string): string {
  return ACAO_LABELS[acao] ?? acao
}

/**
 * Nome de quem fez. Profile vem do mapa de autores (mesmo esquema do
 * HistoricoTab); sem profile, a descrição que o banco gravou.
 */
export function labelAutor(
  evento: Pick<EventoAuditoria, 'autor_id' | 'autor_descricao'>,
  autores: ReadonlyMap<string, string>,
): string {
  if (evento.autor_id) return autores.get(evento.autor_id) ?? 'usuário removido'
  if (evento.autor_descricao) {
    return AUTOR_DESCRICAO_LABELS[evento.autor_descricao] ?? evento.autor_descricao
  }
  return '—'
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Filtro `.or()` da busca. Um uuid colado procura o registro (é o que se faz
 * vindo de uma tela de detalhe); qualquer outro texto procura na referência
 * (o número da proposta, o nome do cliente), na mensagem e na descrição do
 * autor. Espera o termo já passado por `sanitizeBusca`.
 */
export function filtroBuscaAuditoria(busca: string): string | null {
  const termo = busca.trim()
  if (!termo) return null
  if (UUID.test(termo)) return `registro_id.eq.${termo.toLowerCase()}`
  return `referencia.ilike.%${termo}%,mensagem.ilike.%${termo}%,autor_descricao.ilike.%${termo}%`
}

export type CampoAlterado = { campo: string; de: unknown; para: unknown }

function isObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** `detalhe.campos` do update, em ordem alfabética. Vazio se não houver. */
export function camposAlterados(detalhe: unknown): CampoAlterado[] {
  if (!isObjeto(detalhe) || !isObjeto(detalhe.campos)) return []
  return Object.entries(detalhe.campos)
    .map(([campo, v]) =>
      isObjeto(v) ? { campo, de: v.de ?? null, para: v.para ?? null } : { campo, de: null, para: v },
    )
    .sort((a, b) => a.campo.localeCompare(b.campo))
}

/** `detalhe.linha` de criação/exclusão, ou null. */
export function linhaDoEvento(detalhe: unknown): Record<string, unknown> | null {
  if (!isObjeto(detalhe) || !isObjeto(detalhe.linha)) return null
  return detalhe.linha
}

/** Valor de jsonb pra uma célula de texto. */
export function formatarValorAuditoria(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'sim' : 'não'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Uma linha de texto pra coluna "Resumo" da tabela. */
export function resumoEvento(evento: Pick<EventoAuditoria, 'acao' | 'mensagem' | 'detalhe'>): string {
  if (evento.mensagem) return evento.mensagem
  const campos = camposAlterados(evento.detalhe)
  const status = campos.find((c) => c.campo === 'status')
  if (status) {
    return `status: ${formatarValorAuditoria(status.de)} → ${formatarValorAuditoria(status.para)}`
  }
  if (campos.length === 1) return `${campos[0].campo} alterado`
  if (campos.length > 1) return `${campos.length} campos alterados`
  if (evento.acao === 'criar') return 'registro criado'
  if (evento.acao === 'excluir') return 'registro excluído'
  return '—'
}

/** Telas de detalhe que existem hoje. Exclusão não tem pra onde ir. */
const ROTA_DE_DETALHE: Record<string, string> = {
  propostas: '/propostas',
  orcamentos: '/orcamentos',
  obras: '/obras',
  fd: '/fd',
}

export function hrefDoRegistro(
  evento: Pick<EventoAuditoria, 'entidade' | 'registro_id' | 'acao'>,
): string | null {
  const base = ROTA_DE_DETALHE[evento.entidade]
  if (!base || !evento.registro_id || evento.acao === 'excluir') return null
  return `${base}/${evento.registro_id}`
}
