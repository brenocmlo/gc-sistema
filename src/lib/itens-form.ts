import { z } from 'zod'

import { UNIDADES } from './itens.ts'
import type { Item, Unidade } from './types'

/**
 * Validação do item, compartilhada por DUAS entradas:
 *
 *   1. o formulário completo do bloco 5.3 (modal), via `zodResolver`;
 *   2. cada linha da planilha do bloco 5.4, via `validarLinhaImportacao`.
 *
 * Por isso mora em `src/lib/` e não ao lado do formulário, como o
 * `fd-form-helpers.ts`: é o mesmo contrato para os dois caminhos, e sendo
 * helper puro (sem `use client`, sem React) fica coberto por `node --test`.
 * Validação duplicada entre tela e importação seria a garantia de que uma das
 * duas ficaria desatualizada.
 */

/** Campo de texto opcional: string vazia do formulário vira null no banco. */
const textoOpcional = (max: number) =>
  z
    .string()
    .max(max, `Máximo de ${max} caracteres`)
    .optional()
    .default('')

/**
 * Número opcional que aceita vazio.
 *
 * `z.coerce.number()` sozinho transforma `''` em 0, que aqui seria mentira:
 * campo em branco significa "não sei", e 0 é um valor que o banco aceitaria
 * como verdade (a mesma regra que a tabela do 5.2 segue).
 */
const numeroOpcional = (rotulo: string) =>
  z
    .union([z.literal(''), z.coerce.number()])
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : Number(v)))
    .refine((v) => v === null || Number.isFinite(v), {
      message: `${rotulo} inválida`,
    })
    .refine((v) => v === null || v >= 0, {
      message: `${rotulo} não pode ser negativa`,
    })

export type ContextoItemForm = {
  /**
   * Números já usados por OUTROS itens do mesmo pai. Serve para avisar na tela
   * antes de o banco recusar pelo unique parcial
   * (`idx_itens_numero_proposta` / `idx_itens_numero_contrato`).
   *
   * Não substitui o unique: entre o render e o submit alguém pode ter gravado.
   * A recusa do banco continua traduzida por `mensagemDeErroItem`.
   */
  numerosEmUso: readonly number[]
}

export function criarItemFormSchema(ctx: ContextoItemForm) {
  return z.object({
    numero: z
      .union([z.literal(''), z.coerce.number()])
      .optional()
      .transform((v) => (v === '' || v === undefined ? null : Number(v)))
      .refine((v) => v === null || Number.isInteger(v), {
        message: 'O número do item tem de ser inteiro',
      })
      .refine((v) => v === null || v > 0, {
        message: 'O número do item tem de ser maior que zero',
      })
      .refine((v) => v === null || !ctx.numerosEmUso.includes(v), {
        message: 'Já existe um item com esse número nesta proposta',
      }),

    tipo: textoOpcional(100),
    descricao: textoOpcional(1000),
    linha: textoOpcional(100),
    acabamento: textoOpcional(100),
    localizacao: textoOpcional(200),
    vidros: textoOpcional(200),
    observacao: textoOpcional(1000),

    largura: numeroOpcional('Largura'),
    altura: numeroOpcional('Altura'),

    // Quantidade é o único numérico obrigatório: é dele que saem as duas
    // colunas GENERATED. Zero tornaria valor_total e area_m2 zero, e o item
    // entraria na proposta sem valer nada.
    quantidade: z.coerce
      .number({ message: 'Quantidade obrigatória' })
      .refine((v) => Number.isFinite(v), { message: 'Quantidade inválida' })
      .refine((v) => v > 0, { message: 'Quantidade tem de ser maior que zero' }),

    unidade: z.enum(UNIDADES, {
      message: 'Unidade tem de ser Quantidade (un) ou Metro quadrado (m²)',
    }),

    valor_unit: numeroOpcional('Valor unitário'),
  })
}

/** Tipos derivados do schema. O schema real vem de `criarItemFormSchema`. */
export type ItemFormSchema = ReturnType<typeof criarItemFormSchema>
export type ItemFormValues = z.input<ItemFormSchema>
export type ItemFormSaida = z.output<ItemFormSchema>

/**
 * O que vai para a Server Action. Campo de texto vazio vira `null` — a coluna
 * é nullable e string vazia no banco é pior que ausência: some dos filtros e
 * não aparece como "—" na tela.
 *
 * `valor_total` e `area_m2` NÃO estão aqui, e nem podem: são colunas GENERATED
 * (ver `COLUNAS_GERADAS_ITEM`).
 */
export function itemFormParaPayload(v: ItemFormSaida) {
  const vazioParaNulo = (s: string) => {
    const t = s.trim()
    return t === '' ? null : t
  }

  return {
    numero: v.numero,
    tipo: vazioParaNulo(v.tipo),
    descricao: vazioParaNulo(v.descricao),
    linha: vazioParaNulo(v.linha),
    acabamento: vazioParaNulo(v.acabamento),
    localizacao: vazioParaNulo(v.localizacao),
    vidros: vazioParaNulo(v.vidros),
    observacao: vazioParaNulo(v.observacao),
    largura: v.largura,
    altura: v.altura,
    quantidade: v.quantidade,
    unidade: v.unidade as Unidade,
    valor_unit: v.valor_unit,
  }
}

/** Item do banco → valores do formulário. Nulo vira string vazia no input. */
export function itemParaFormValues(item: Item): ItemFormValues {
  const texto = (s: string | null) => s ?? ''
  const num = (n: number | null) => (n === null ? '' : n)

  return {
    numero: num(item.numero),
    tipo: texto(item.tipo),
    descricao: texto(item.descricao),
    linha: texto(item.linha),
    acabamento: texto(item.acabamento),
    localizacao: texto(item.localizacao),
    vidros: texto(item.vidros),
    observacao: texto(item.observacao),
    largura: num(item.largura),
    altura: num(item.altura),
    quantidade: item.quantidade ?? 1,
    unidade: item.unidade ?? 'QTD',
    valor_unit: num(item.valor_unit),
  }
}

/** Valores de um item novo. `numero` já vem sugerido pelo chamador. */
export function itemFormVazio(numeroSugerido: number | null): ItemFormValues {
  return {
    numero: numeroSugerido ?? '',
    tipo: '',
    descricao: '',
    linha: '',
    acabamento: '',
    localizacao: '',
    vidros: '',
    observacao: '',
    largura: '',
    altura: '',
    quantidade: 1,
    unidade: 'QTD',
    valor_unit: '',
  }
}

// ============================================================
// Importação em massa (bloco 5.4)
// ============================================================

/**
 * Colunas do template XLSX, na ordem. `chave` casa com o campo do formulário,
 * então a validação é a MESMA — é o motivo de este arquivo existir.
 */
export const COLUNAS_IMPORTACAO = [
  { chave: 'numero', titulo: 'Nº', largura: 8, exemplo: 1 },
  { chave: 'tipo', titulo: 'Tipo', largura: 16, exemplo: 'Janela' },
  { chave: 'descricao', titulo: 'Descrição', largura: 44, exemplo: 'Janela de correr 2 folhas' },
  { chave: 'linha', titulo: 'Linha', largura: 16, exemplo: 'Suprema' },
  { chave: 'acabamento', titulo: 'Acabamento', largura: 16, exemplo: 'Branco' },
  { chave: 'localizacao', titulo: 'Localização', largura: 20, exemplo: 'Fachada frontal' },
  { chave: 'vidros', titulo: 'Vidros', largura: 20, exemplo: 'Temperado 6mm incolor' },
  { chave: 'largura', titulo: 'Largura (m)', largura: 13, exemplo: 1.5 },
  { chave: 'altura', titulo: 'Altura (m)', largura: 13, exemplo: 1.2 },
  { chave: 'quantidade', titulo: 'Quantidade', largura: 13, exemplo: 4 },
  { chave: 'unidade', titulo: 'Unidade (QTD ou M2)', largura: 20, exemplo: 'M2' },
  { chave: 'valor_unit', titulo: 'Valor unitário', largura: 15, exemplo: 890.5 },
  { chave: 'observacao', titulo: 'Observação', largura: 30, exemplo: '[EXEMPLO] apague esta linha' },
] as const

/**
 * Marca da linha de exemplo do template, no começo da Observação.
 *
 * A linha de exemplo é VÁLIDA — tem quantidade, unidade e valor. Sem a marca,
 * ela passava no preview em verde e era importada como item de verdade, na
 * primeira posição, com número 1. A conferência dos documentos da sprint 5
 * pegou isso: o comentário do template dizia o contrário do que o código fazia.
 */
export const MARCA_EXEMPLO = '[EXEMPLO]'

/** Linhas de instrução do topo do template. A rota e os testes leem daqui. */
export const INSTRUCOES_TEMPLATE: readonly string[] = [
  'Template de importação de itens — GC Sistema',
  'Preencha uma linha por item. Não altere, não reordene e não remova as colunas.',
  'Quantidade é obrigatória e tem de ser maior que zero. Unidade aceita QTD ou M2 (vazio = QTD).',
  'Área m² e Valor total NÃO entram na planilha: o sistema calcula (largura × altura × qtd e valor unit. × qtd).',
  'A linha marcada com [EXEMPLO] é recusada na importação: apague ou sobrescreva.',
]

export type ChaveImportacao = (typeof COLUNAS_IMPORTACAO)[number]['chave']

export type LinhaImportacao = Partial<Record<ChaveImportacao, unknown>>

export type LinhaValidada =
  | { linha: number; ok: true; valores: ItemFormSaida; bruto: LinhaImportacao }
  | { linha: number; ok: false; erros: string[]; bruto: LinhaImportacao }

/**
 * Valida UMA linha da planilha com o mesmo schema do formulário.
 *
 * `numerosEmUso` acumula ao longo do arquivo: duas linhas com o mesmo número
 * colidiriam no banco pelo unique parcial, e acusar isso no preview é melhor
 * que deixar metade importar e a outra metade falhar.
 */
export function validarLinhaImportacao(
  numeroDaLinha: number,
  bruto: LinhaImportacao,
  numerosEmUso: readonly number[],
): LinhaValidada {
  const schema = criarItemFormSchema({ numerosEmUso })

  // A planilha traz célula vazia como undefined/null; o schema espera '' nos
  // campos de texto e aceita '' nos numéricos.
  const normalizado: Record<string, unknown> = {}
  for (const col of COLUNAS_IMPORTACAO) {
    const v = bruto[col.chave]
    normalizado[col.chave] = v === null || v === undefined ? '' : v
  }
  // `unidade` não tem default: célula vazia cai em QTD, que é o default da
  // coluna no banco, em vez de reprovar a linha inteira por isso.
  if (normalizado.unidade === '') normalizado.unidade = 'QTD'

  if (String(normalizado.observacao).trim().startsWith(MARCA_EXEMPLO)) {
    return {
      linha: numeroDaLinha,
      ok: false,
      bruto,
      erros: ['É a linha de exemplo do template: apague ou sobrescreva antes de importar'],
    }
  }

  const r = schema.safeParse(normalizado)
  if (!r.success) {
    return {
      linha: numeroDaLinha,
      ok: false,
      bruto,
      erros: r.error.issues.map((i) => {
        const campo = i.path[0]
        const titulo =
          COLUNAS_IMPORTACAO.find((c) => c.chave === campo)?.titulo ?? String(campo)
        return `${titulo}: ${i.message}`
      }),
    }
  }
  return { linha: numeroDaLinha, ok: true, valores: r.data, bruto }
}

/**
 * Valida a planilha inteira, acumulando os números já vistos.
 *
 * `numerosExistentes` são os do banco; os das linhas válidas entram no
 * acumulador conforme passam, para que a segunda linha com o mesmo número
 * seja acusada no preview e não no meio do insert.
 */
export function validarPlanilha(
  linhas: LinhaImportacao[],
  numerosExistentes: readonly number[],
  /** Linha real de cada uma no arquivo (`lerPlanilhaItens` devolve). */
  numerosDasLinhas?: readonly number[],
): LinhaValidada[] {
  const emUso = [...numerosExistentes]
  const saida: LinhaValidada[] = []

  for (let i = 0; i < linhas.length; i++) {
    // Sem a numeração real, cai no antigo +2 (cabeçalho na linha 1).
    const r = validarLinhaImportacao(numerosDasLinhas?.[i] ?? i + 2, linhas[i], emUso)
    if (r.ok && r.valores.numero !== null) emUso.push(r.valores.numero)
    saida.push(r)
  }

  return saida
}

/** Resumo do preview: o que a tela mostra antes de confirmar. */
export function resumoDaPlanilha(linhas: LinhaValidada[]): {
  total: number
  validas: number
  comErro: number
} {
  const validas = linhas.filter((l) => l.ok).length
  return { total: linhas.length, validas, comErro: linhas.length - validas }
}
