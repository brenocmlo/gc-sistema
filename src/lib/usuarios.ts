import { z } from 'zod'

import { mensagemDeErroBanco } from './erro-banco.ts'
import { PHONE_REGEX } from './phone.ts'
import { PERFIL_LABELS } from './types.ts'
import type { Perfil } from './types'

// ============================================================
// Gestão de usuários (13.1)
// ============================================================

export const PERFIS: readonly Perfil[] = ['admin', 'comercial', 'producao', 'medicao', 'financeiro', 'visualizador']

export const PERFIL_OPTIONS = PERFIS.map((p) => ({ value: p, label: PERFIL_LABELS[p] }))

/** O que cada perfil faz, para o admin escolher no convite. */
export const PERFIL_DESCRICOES: Record<Perfil, string> = {
  admin: 'Tudo, inclusive usuários, configurações, estornos e exclusões',
  comercial: 'Clientes, orçamentos, obras, propostas, contratos e documentos',
  producao: 'Aponta fabricação, entrega e instalação',
  medicao: 'Aponta a medição e gera o relatório de medição',
  financeiro: 'Notas fiscais, pagamentos, acordos e FD',
  visualizador: 'Consulta tudo, sem criar, editar nem excluir',
}

export function isPerfil(v: unknown): v is Perfil {
  return typeof v === 'string' && (PERFIS as readonly string[]).includes(v)
}

const telefone = z
  .string()
  .trim()
  .optional()
  .default('')
  .refine((v) => v === '' || PHONE_REGEX.test(v), 'Formato: (XX) XXXXX-XXXX')

export const usuarioSchema = z.object({
  nome: z.string().trim().min(2, 'Nome precisa ter ao menos 2 caracteres').max(100, 'Máximo 100 caracteres'),
  perfil: z.string().refine(isPerfil, 'Escolha o perfil'),
  telefone,
})

export const conviteSchema = usuarioSchema.extend({
  email: z.string().trim().toLowerCase().min(1, 'Informe o e-mail').email('E-mail inválido'),
})

export type UsuarioFormValues = z.input<typeof usuarioSchema>
export type ConviteFormValues = z.input<typeof conviteSchema>

export type UsuarioPayload = { nome: string; perfil: Perfil; telefone: string | null }

export function usuarioPayload(v: z.output<typeof usuarioSchema>): UsuarioPayload {
  return { nome: v.nome, perfil: v.perfil as Perfil, telefone: v.telefone === '' ? null : v.telefone }
}

export type SituacaoUsuario = 'ativo' | 'convite_pendente' | 'inativo'

export const SITUACAO_USUARIO_LABELS: Record<SituacaoUsuario, string> = {
  ativo: 'Ativo',
  convite_pendente: 'Convite pendente',
  inativo: 'Inativo',
}

/**
 * Inativo vence tudo (o admin desligou). Fora isso, quem nunca entrou e não
 * confirmou o e-mail ainda não aceitou o convite.
 */
export function situacaoDoUsuario(u: { ativo: boolean | null; ultimo_acesso: string | null; email_confirmado: boolean }): SituacaoUsuario {
  if (u.ativo === false) return 'inativo'
  if (!u.ultimo_acesso && !u.email_confirmado) return 'convite_pendente'
  return 'ativo'
}

export type TipoDeLink = 'invite' | 'recovery'

/**
 * O link que o admin manda à pessoa. Aponta para a rota /convite do próprio
 * sistema, que troca o token pela sessão (verifyOtp) e leva à tela de definir
 * a senha. Assim o convite não depende de e-mail: vai por WhatsApp, e-mail ou
 * como o admin preferir.
 */
export function linkDeAcesso(origem: string, tokenHash: string, tipo: TipoDeLink): string {
  const u = new URL('/convite', origem)
  u.searchParams.set('token_hash', tokenHash)
  u.searchParams.set('type', tipo)
  return u.toString()
}

/** Querystring é input externo: só os dois tipos que a rota /convite aceita. */
export function tipoDeLinkValido(v: unknown): v is TipoDeLink {
  return v === 'invite' || v === 'recovery'
}

export const SENHA_MIN = 8

const senhaCampos = z.object({
  senha: z.string().min(SENHA_MIN, `A senha precisa ter ao menos ${SENHA_MIN} caracteres`).max(72, 'Máximo 72 caracteres'),
  confirmacao: z.string(),
})

export const senhaSchema = senhaCampos.refine((v) => v.senha === v.confirmacao, {
  message: 'As senhas não conferem',
  path: ['confirmacao'],
})

export type SenhaFormValues = z.input<typeof senhaSchema>

/** Erro do Postgres ou do Auth → mensagem de quem administra. */
export function mensagemDeErroUsuario(raw: string): string {
  if (raw.includes('ao menos um admin ativo')) return 'A empresa precisa de ao menos um admin ativo'
  if (raw.includes('Só o admin muda')) return 'Só o admin muda o perfil, a situação ou o e-mail de um usuário'
  if (raw.includes('idx_profiles_email_empresa_unique')) return 'Já existe um usuário com esse e-mail na empresa'
  if (/already (been )?registered|already exists|email_exists/i.test(raw)) return 'Esse e-mail já tem acesso ao sistema'
  if (raw.includes('profiles_email_format')) return 'E-mail inválido'
  return mensagemDeErroBanco(raw)
}

// ------------------------------------------------------------------
// "Esqueci minha senha": o pedido vai para o administrador (19/10)
// ------------------------------------------------------------------

export const esqueciSchema = z.object({
  email: z.string().trim().min(1, 'Informe o e-mail').email('E-mail inválido').transform((v) => v.toLowerCase()),
})

export type EsqueciFormValues = z.input<typeof esqueciSchema>

/** A resposta é a mesma com e-mail cadastrado ou não: a tela não revela quem tem conta. */
export const MENSAGEM_PEDIDO_ENVIADO =
  'Pedido enviado. Se o e-mail tiver acesso ao sistema, o administrador vai te mandar um link para criar uma senha nova.'

/** Intervalo mínimo entre dois pedidos da mesma pessoa: o segundo clique não vira outro pedido. */
export const INTERVALO_ENTRE_PEDIDOS_MS = 10 * 60 * 1000

export function deveRegistrarPedido(ultimoPedidoEm: string | null, agora: Date = new Date()): boolean {
  if (!ultimoPedidoEm) return true
  const t = new Date(ultimoPedidoEm).getTime()
  if (Number.isNaN(t)) return true
  return agora.getTime() - t >= INTERVALO_ENTRE_PEDIDOS_MS
}

// ------------------------------------------------------------------
// Meu perfil: a pessoa edita os próprios dados e troca a senha (s14)
// ------------------------------------------------------------------

/**
 * Só nome e telefone. Perfil, situação e e-mail são do admin: o trigger
 * profiles_proteger recusa, e o schema nem os aceita (z.object descarta chave
 * desconhecida, então um `perfil` no payload some antes do update).
 */
export const meuPerfilSchema = usuarioSchema.pick({ nome: true, telefone: true })

export type MeuPerfilFormValues = z.input<typeof meuPerfilSchema>

export function meuPerfilPayload(v: z.output<typeof meuPerfilSchema>): { nome: string; telefone: string | null } {
  return { nome: v.nome, telefone: v.telefone === '' ? null : v.telefone }
}

/** A senha atual é conferida no servidor antes da troca: sessão aberta esquecida não basta. */
export const trocaSenhaSchema = senhaCampos
  .extend({ senhaAtual: z.string().min(1, 'Informe a senha atual') })
  .refine((v) => v.senha === v.confirmacao, { message: 'As senhas não conferem', path: ['confirmacao'] })
  .refine((v) => v.senha !== v.senhaAtual, { message: 'A nova senha precisa ser diferente da atual', path: ['senha'] })

export type TrocaSenhaFormValues = z.input<typeof trocaSenhaSchema>

/** Erro do Auth na troca de senha → mensagem de quem está trocando. */
export function mensagemDeErroSenha(raw: string): string {
  if (/invalid login credentials/i.test(raw)) return 'Senha atual incorreta'
  if (/different from the old|same_password/i.test(raw)) return 'A nova senha precisa ser diferente da anterior'
  if (/weak_password|password should/i.test(raw)) return 'Senha fraca: use letras e números'
  if (/rate limit|too many/i.test(raw)) return 'Muitas tentativas. Espere alguns minutos e tente de novo'
  return raw
}
