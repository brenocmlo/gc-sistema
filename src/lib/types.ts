import type { Database } from './supabase/types'

// ============================================================
// Perfis (CHECK constraint em profiles.perfil)
// ============================================================

export type Perfil =
  | 'admin'
  | 'comercial'
  | 'producao'
  | 'medicao'
  | 'financeiro'
  | 'visualizador'

export const PERFIL_LABELS: Record<Perfil, string> = {
  admin: 'Admin',
  comercial: 'Comercial',
  producao: 'Produção',
  medicao: 'Medição',
  financeiro: 'Financeiro',
  visualizador: 'Visualizador',
}

// ============================================================
// Status por entidade (CHECK constraints — o Supabase não gera
// union types pra CHECK, então mantemos manualmente)
// ============================================================

export type OrcamentoStatus =
  | 'pendente'
  | 'analise'
  | 'enviado'
  | 'aprovado'
  | 'rejeitado'
  | 'expirado'

export type ObraStatus = 'ativa' | 'concluida' | 'suspensa' | 'cancelada'

export type PropostaStatus = 'rascunho' | 'enviada' | 'aprovada' | 'rejeitada'

export type ContratoStatus =
  | 'ativo'
  | 'concluido'
  | 'suspenso'
  | 'rescindido'

export type NotaFiscalStatus =
  | 'emitida'
  | 'paga_parcialmente'
  | 'paga'
  | 'cancelada'

export type AcordoStatus = 'aberto' | 'quitado' | 'cancelado' | 'convertido_nf'

// 'atrasada' foi removida do banco — agora é calculada em runtime
// (data_vencimento < today and status = 'pendente')
export type ParcelaStatus =
  | 'pendente'
  | 'paga'
  | 'paga_parcialmente'
  | 'cancelada'

// Status visual derivado de FD (não existe no banco — calculado em runtime)
export type StatusFdPagamento = 'pendente' | 'pago' | 'vencido'

// Mesma lista usada por orcamentos e propostas
export type MotivoRejeicao =
  | 'preco_alto'
  | 'prazo_curto'
  | 'perdeu_concorrente'
  | 'cliente_desistiu'
  | 'sem_resposta'
  | 'escopo_mudou'
  | 'sem_capacidade'
  | 'outro'

// Alias mantido pra compatibilidade com código existente
export type MotivoRejeicaoOrcamento = MotivoRejeicao

export const MOTIVO_REJEICAO_LABELS: Record<MotivoRejeicao, string> = {
  preco_alto: 'Preço acima do esperado',
  prazo_curto: 'Prazo inviável',
  perdeu_concorrente: 'Cliente escolheu concorrente',
  cliente_desistiu: 'Cliente desistiu do projeto',
  sem_resposta: 'Cliente não respondeu',
  escopo_mudou: 'Escopo do projeto mudou',
  sem_capacidade: 'Não tínhamos capacidade',
  outro: 'Outro',
}

export type MotivoRescisaoContrato =
  | 'inadimplencia'
  | 'descumprimento_prazo'
  | 'acordo_partes'
  | 'forca_maior'
  | 'outro'

export const MOTIVO_RESCISAO_LABELS: Record<MotivoRescisaoContrato, string> = {
  inadimplencia: 'Inadimplência',
  descumprimento_prazo: 'Descumprimento de prazo',
  acordo_partes: 'Acordo entre as partes',
  forca_maior: 'Força maior',
  outro: 'Outro',
}

// ============================================================
// Anexos (guardados como jsonb array em várias tabelas)
// ============================================================

export type Anexo = {
  nome: string // nome original do arquivo
  path: string // path dentro do bucket do Storage
  tipo: string // MIME type
  tamanho: number // bytes
  uploaded_at: string // ISO timestamp
  uploaded_by: string // uuid do user em auth.users
}

// ============================================================
// Aliases de tabelas — Row / Insert / Update
// Gerado a partir do Database type de './supabase/types'
// ============================================================

type Tables = Database['public']['Tables']
type Views = Database['public']['Views']

// Sistema
export type Empresa = Tables['empresas']['Row']
export type EmpresaInsert = Tables['empresas']['Insert']
export type EmpresaUpdate = Tables['empresas']['Update']

// profile.perfil vem como `string` no gen (CHECK constraint), mas é
// garantido ser um dos valores do enum Perfil pelo banco.
export type Profile = Omit<Tables['profiles']['Row'], 'perfil'> & {
  perfil: Perfil
}
export type ProfileInsert = Tables['profiles']['Insert']
export type ProfileUpdate = Tables['profiles']['Update']

// Clientes (tabela nova, aceita PF e PJ via cnpj_cpf único campo)
export type Cliente = Tables['clientes']['Row']
export type ClienteInsert = Tables['clientes']['Insert']
export type ClienteUpdate = Tables['clientes']['Update']

// Funil comercial
// orcamentos.status é string no gen (CHECK constraint) — narrar pra OrcamentoStatus
export type Orcamento = Omit<Tables['orcamentos']['Row'], 'status'> & {
  status: OrcamentoStatus
}
export type OrcamentoInsert = Tables['orcamentos']['Insert']
export type OrcamentoUpdate = Tables['orcamentos']['Update']

// Subset de campos pra listagem — JOIN com clientes pra exibir nome e cidade
export type OrcamentoListItem = Pick<
  Orcamento,
  | 'id'
  | 'numero'
  | 'data_solicitacao'
  | 'cliente_id'
  | 'status'
  | 'valor_estimado'
  | 'responsavel'
> & {
  cliente: Pick<Cliente, 'nome' | 'cidade'> | null
}

export type Proposta = Omit<Tables['propostas']['Row'], 'status'> & {
  status: PropostaStatus
}
export type PropostaInsert = Tables['propostas']['Insert']
export type PropostaUpdate = Tables['propostas']['Update']

export type Contrato = Omit<Tables['contratos']['Row'], 'status'> & {
  status: ContratoStatus
}
export type ContratoInsert = Tables['contratos']['Insert']
export type ContratoUpdate = Tables['contratos']['Update']

// Operação
export type Obra = Tables['obras']['Row']
export type ObraInsert = Tables['obras']['Insert']
export type ObraUpdate = Tables['obras']['Update']

export type Item = Tables['itens']['Row']
export type ItemInsert = Tables['itens']['Insert']
export type ItemUpdate = Tables['itens']['Update']

export type Execucao = Tables['execucao']['Row']
export type ExecucaoInsert = Tables['execucao']['Insert']
export type ExecucaoUpdate = Tables['execucao']['Update']

// Financeiro
export type NotaFiscal = Tables['notas_fiscais']['Row']
export type NotaFiscalInsert = Tables['notas_fiscais']['Insert']
export type NotaFiscalUpdate = Tables['notas_fiscais']['Update']

export type Pagamento = Tables['pagamentos']['Row']
export type PagamentoInsert = Tables['pagamentos']['Insert']
export type PagamentoUpdate = Tables['pagamentos']['Update']

export type AcordoPagamento = Tables['acordos_pagamento']['Row']
export type AcordoPagamentoInsert = Tables['acordos_pagamento']['Insert']
export type AcordoPagamentoUpdate = Tables['acordos_pagamento']['Update']

export type AcordoParcela = Tables['acordo_parcelas']['Row']
export type AcordoParcelaInsert = Tables['acordo_parcelas']['Insert']
export type AcordoParcelaUpdate = Tables['acordo_parcelas']['Update']

export type Fd = Tables['fd']['Row']
export type FdInsert = Tables['fd']['Insert']
export type FdUpdate = Tables['fd']['Update']

// ============================================================
// Views (somente Row — views são read-only)
// ============================================================

// A view `obras_com_valores` vem com todos os campos nullable por causa
// do LATERAL JOIN, mas os campos da tabela obras propagados são NOT NULL
// na prática. Narrowing aqui economiza ?? e casts espalhados.
type _ObraViewRow = Views['obras_com_valores']['Row']
export type ObraListItem = Omit<
  _ObraViewRow,
  'id' | 'empresa_id' | 'codigo_obra' | 'nome' | 'status'
> & {
  id: string
  empresa_id: string
  codigo_obra: string
  nome: string
  status: ObraStatus
  cliente: Pick<Cliente, 'nome'> | null
}

export type ItemComStatus = Views['itens_com_status']['Row']
export type ReceitaObra = Views['receitas_obra']['Row']
export type ObraFinanceiro = Views['obras_financeiro']['Row']
export type ContratoFinanceiro = Views['contratos_financeiro']['Row']
export type PropostaFinanceiro = Views['propostas_financeiro']['Row']
