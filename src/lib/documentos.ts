// Documentos recebidos pela automação (Fase 7): a caixa de entrada do bot e o
// que for enviado pela tela. Tabela `documentos_processamento`.
// Helpers puros — sem 'use client' e sem React — pra servirem página, actions
// e componentes, e serem testáveis por node --test.

export const DOCUMENTO_STATUS = ['PENDENTE', 'ERRO_VALIDACAO', 'REVISAO_HUMANA', 'APROVADO'] as const
export type DocumentoStatus = (typeof DOCUMENTO_STATUS)[number]

export const DOCUMENTO_STATUS_LABELS: Record<DocumentoStatus, string> = {
  PENDENTE: 'Processando',
  ERRO_VALIDACAO: 'Faltam dados',
  REVISAO_HUMANA: 'Precisa de revisão',
  APROVADO: 'Registrado',
}

/** Classes do selo, no mesmo estilo do StatusBadge compartilhado. */
export const DOCUMENTO_STATUS_CLASSES: Record<DocumentoStatus, string> = {
  PENDENTE: 'bg-gray-100 text-gray-600 border-gray-200',
  ERRO_VALIDACAO: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  REVISAO_HUMANA: 'bg-orange-100 text-orange-700 border-orange-200',
  APROVADO: 'bg-green-100 text-green-700 border-green-200',
}

export const STATUS_DOCUMENTO_OPTIONS: readonly { value: DocumentoStatus; label: string }[] =
  DOCUMENTO_STATUS.map((s) => ({ value: s, label: DOCUMENTO_STATUS_LABELS[s] }))

export function isDocumentoStatus(v: unknown): v is DocumentoStatus {
  return typeof v === 'string' && (DOCUMENTO_STATUS as readonly string[]).includes(v)
}

export const TIPO_DOCUMENTO_LABELS: Record<string, string> = {
  PROPOSTA: 'Proposta',
  CONTRATO: 'Contrato',
}

export function rotuloTipo(tipo: string | null | undefined): string {
  return (tipo && TIPO_DOCUMENTO_LABELS[tipo]) || tipo || '—'
}

/** De onde o documento veio. Canal nulo = enviado pela tela do sistema. */
export function rotuloOrigem(canal: string | null | undefined): string {
  if (canal === 'TELEGRAM') return 'Telegram'
  if (canal === 'WHATSAPP') return 'WhatsApp'
  return 'Pela tela'
}

/** Linha da listagem. */
export type DocumentoListItem = {
  id: string
  status: string
  tipo_documento: string
  canal: string | null
  obra_id: string | null
  created_at: string | null
  motivo_revisao: string | null
  proposta_criada_id: string | null
  contrato_criado_id: string | null
  dados_extraidos: unknown
  obra: { codigo_obra: string | null; nome: string | null } | null
}

type Dados = Record<string, unknown>

function comoDados(v: unknown): Dados {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Dados) : {}
}

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function numero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

/**
 * O que a leitura automática achou, tolerando as várias formas que o
 * `dados_extraidos` já teve: o fluxo novo grava `numero`/`valorProposta`, o
 * de agosto gravava `numeroContrato`/`valorContrato`, e o Gemini devolve
 * `numero_contrato`/`valor_total` crus.
 */
export function resumoDoDocumento(dadosExtraidos: unknown): {
  numero: string | null
  valor: number | null
  cliente: string | null
  itens: number
  extrator: string | null
  itensConfiaveis: boolean | null
} {
  const d = comoDados(dadosExtraidos)
  const itens = Array.isArray(d.itens) ? d.itens.length : 0
  return {
    numero: texto(d.numero) ?? texto(d.numeroContrato) ?? texto(d.numero_contrato),
    valor: numero(d.valorProposta) ?? numero(d.valorContrato) ?? numero(d.valor_total),
    cliente: texto(d.cliente_nome),
    itens,
    extrator: texto(d.extrator),
    itensConfiaveis: typeof d.itensConfiaveis === 'boolean' ? d.itensConfiaveis : null,
  }
}

/** Itens como a leitura devolveu, para a tabela do detalhe. */
export type ItemLido = {
  numero: string | null
  descricao: string | null
  quantidade: number | null
  unidade: string | null
  valor_unitario: number | null
  valor_total: number | null
  tipo: string | null
  localizacao: string | null
}

export function itensLidos(dadosExtraidos: unknown): ItemLido[] {
  const d = comoDados(dadosExtraidos)
  if (!Array.isArray(d.itens)) return []
  return d.itens.map((bruto) => {
    const it = comoDados(bruto)
    return {
      numero: texto(it.numero),
      descricao: texto(it.descricao),
      quantidade: numero(it.quantidade),
      unidade: texto(it.unidade),
      valor_unitario: numero(it.valor_unitario),
      valor_total: numero(it.valor_total),
      tipo: texto(it.tipo),
      localizacao: texto(it.localizacao),
    }
  })
}

/** Para onde o documento levou, se levou a algum lugar. */
export function destinoDoDocumento(
  d: Pick<DocumentoListItem, 'proposta_criada_id' | 'contrato_criado_id'>,
): { href: string; rotulo: string } | null {
  if (d.proposta_criada_id) return { href: `/propostas/${d.proposta_criada_id}`, rotulo: 'Ver proposta' }
  if (d.contrato_criado_id) return { href: `/contratos/${d.contrato_criado_id}`, rotulo: 'Ver contrato' }
  return null
}

/**
 * Path do arquivo dentro do bucket `documentos-processamento`, tirado da URL
 * assinada guardada em `arquivo_url` (o bot guarda a URL, não o path). A
 * tela gera uma assinatura nova a partir dele, porque a guardada expira.
 */
export function caminhoDoArquivo(arquivoUrl: string | null | undefined): string | null {
  if (!arquivoUrl) return null
  const m = arquivoUrl.match(/\/documentos-processamento\/([^?]+)/)
  if (!m) return null
  try {
    return decodeURIComponent(m[1])
  } catch {
    return m[1]
  }
}

// ============================================================
// Envio pela tela (Fase 7, opção C do Breno em 23/09)
// ============================================================

/** O Gemini recebe o PDF inteiro na requisição; 20 MB é o teto do Telegram também. */
export const MAX_ENVIO_BYTES = 20 * 1024 * 1024

export function validarPdfParaEnvio(arquivo: { name: string; type: string; size: number }): string | null {
  const ehPdf = arquivo.type === 'application/pdf' || /\.pdf$/i.test(arquivo.name)
  if (!ehPdf) return 'Envie o documento em PDF'
  if (arquivo.size <= 0) return 'O arquivo está vazio'
  if (arquivo.size > MAX_ENVIO_BYTES) return 'O arquivo passa de 20 MB'
  return null
}

/**
 * Path no bucket `documentos-processamento`. O primeiro segmento é a empresa:
 * é o que a policy do Storage confere (storage_empresa_id_from_path). A pasta
 * `sistema/` separa o que veio pela tela do que veio pelo bot (`telegram/`).
 */
export function caminhoDeEnvio(empresaId: string, nomeArquivo: string, agora: number = Date.now()): string {
  const limpo = nomeArquivo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .toLowerCase()
  return `${empresaId}/sistema/${agora}_${limpo}`
}

/** A action só aceita registrar arquivo que está na pasta de envio da própria empresa. */
export function caminhoEhDaEmpresa(caminho: string, empresaId: string): boolean {
  return caminho.startsWith(`${empresaId}/sistema/`) && !caminho.includes('..')
}
