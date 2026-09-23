import type { Item, ItemPayload, Unidade } from './types'

// ============================================================
// Colunas GENERATED — a regra central desta entidade
// ============================================================

/**
 * Colunas que o banco calcula e que NUNCA entram num insert/update.
 * `20260511151924_revisao_schema.sql` §8:
 *
 *     valor_total generated always as (valor_unit * quantidade) stored
 *     area_m2     generated always as (largura * altura * quantidade) stored
 *
 * Escrever nelas devolve
 * `cannot insert a non-DEFAULT value into column "valor_total"`.
 *
 * O tipo `ItemPayload` já as remove em tempo de compilação; esta lista é a
 * segunda barreira, para payload que chega de fora do TypeScript — corpo de
 * requisição da rota de ingestão, linha de planilha importada (bloco 5.4).
 */
export const COLUNAS_GERADAS_ITEM = ['valor_total', 'area_m2'] as const

export type ColunaGeradaItem = (typeof COLUNAS_GERADAS_ITEM)[number]

/**
 * Remove as colunas geradas de um objeto qualquer antes de mandar ao banco.
 * Devolve um objeto novo — não muta a entrada.
 */
export function limparColunasGeradas<T extends Record<string, unknown>>(
  payload: T,
): Omit<T, ColunaGeradaItem> {
  const limpo = { ...payload }
  for (const coluna of COLUNAS_GERADAS_ITEM) delete limpo[coluna]
  return limpo
}

// ============================================================
// Unidade
// ============================================================

export const UNIDADES = ['QTD', 'M2'] as const

export const UNIDADE_LABELS: Record<Unidade, string> = {
  QTD: 'Quantidade',
  M2: 'Metro quadrado',
}

/** Sufixo curto, para tabela e resumo. */
export const UNIDADE_SUFIXOS: Record<Unidade, string> = {
  QTD: 'un',
  M2: 'm²',
}

export function isUnidade(v: unknown): v is Unidade {
  return v === 'QTD' || v === 'M2'
}

export function formatUnidade(u: Unidade | null | undefined): string {
  return u ? UNIDADE_LABELS[u] : '—'
}

export function formatUnidadeSufixo(u: Unidade | null | undefined): string {
  return u ? UNIDADE_SUFIXOS[u] : ''
}

/**
 * Traduz o que veio de fora para um dos dois valores que o CHECK aceita.
 *
 * Existe porque o documento do cliente escreve a unidade em texto livre —
 * "UN", "PÇ", "m²", "ML", "metro quadrado" — e o OCR devolve literal, de
 * propósito: normalizar dentro do prompt esconderia o caso não previsto em vez
 * de expô-lo. A tradução mora aqui, onde tem teste.
 *
 * Regra: qualquer grafia de metro quadrado vira 'M2'; **todo o resto, incluindo
 * ausente e desconhecido, vira 'QTD'**. Nunca devolve null — item sem unidade
 * legível é contado por peça, que é o padrão da coluna no banco.
 *
 * `reconhecida: false` diz que houve chute, para quem quiser registrar o
 * original em `observacao`.
 */
export function normalizarUnidade(bruto: unknown): {
  unidade: Unidade
  reconhecida: boolean
} {
  if (isUnidade(bruto)) return { unidade: bruto, reconhecida: true }

  if (typeof bruto !== 'string') return { unidade: 'QTD', reconhecida: false }

  const limpo = bruto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // tira acento: "metro quadrado" e "métro"

  if (limpo === '') return { unidade: 'QTD', reconhecida: false }

  const ehM2 =
    limpo === 'm2' ||
    limpo === 'm²' ||
    limpo === 'm^2' ||
    limpo === 'mq' ||
    limpo.startsWith('metro quadrado') ||
    limpo.startsWith('metros quadrados')
  if (ehM2) return { unidade: 'M2', reconhecida: true }

  // Grafias comuns de "por peça" no documento. Viram QTD como as demais, mas
  // são reconhecidas: não houve chute, o documento disse mesmo "unidade".
  const ehQtd =
    limpo === 'qtd' ||
    limpo === 'un' ||
    limpo === 'und' ||
    limpo === 'unid' ||
    limpo === 'unidade' ||
    limpo === 'pc' ||
    limpo === 'pca' ||
    limpo === 'peca' ||
    limpo === 'pecas' ||
    limpo === 'cj' ||
    limpo === 'conj'
  if (ehQtd) return { unidade: 'QTD', reconhecida: true }

  return { unidade: 'QTD', reconhecida: false }
}

// ============================================================
// Dimensões
// ============================================================

const dimFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
})

/** Uma dimensão isolada, em metros: `1,2 m`. */
export function formatDimensao(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  if (Number.isNaN(v)) return '—'
  return `${dimFormatter.format(v)} m`
}

/**
 * Largura × altura: `1,2 × 2,4 m`. Devolve '—' se faltar qualquer uma —
 * "1,2 × — m" não ajuda ninguém.
 */
export function formatDimensoes(
  largura: number | null | undefined,
  altura: number | null | undefined,
): string {
  if (largura === null || largura === undefined) return '—'
  if (altura === null || altura === undefined) return '—'
  if (Number.isNaN(largura) || Number.isNaN(altura)) return '—'
  return `${dimFormatter.format(largura)} × ${dimFormatter.format(altura)} m`
}

const areaFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatArea(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return `${areaFormatter.format(v)} m²`
}

// ============================================================
// Espelhos das colunas geradas — para PREVER na tela, nunca para gravar
// ============================================================

/**
 * Repete `largura * altura * quantidade` do banco.
 *
 * Serve para mostrar a área enquanto a pessoa digita, antes de salvar. O valor
 * que vale é sempre o que volta do banco em `Item.area_m2`; este aqui é
 * previsão. Se as duas divergirem, a fórmula do banco é que está certa.
 *
 * Devolve null quando falta qualquer fator — zero seria mentira.
 */
export function areaDoItem(
  largura: number | null | undefined,
  altura: number | null | undefined,
  quantidade: number | null | undefined,
): number | null {
  if (largura === null || largura === undefined) return null
  if (altura === null || altura === undefined) return null
  if (quantidade === null || quantidade === undefined) return null
  const r = largura * altura * quantidade
  return Number.isFinite(r) ? r : null
}

/** Repete `valor_unit * quantidade` do banco. Mesma ressalva de `areaDoItem`. */
export function valorTotalDoItem(
  valorUnit: number | null | undefined,
  quantidade: number | null | undefined,
): number | null {
  if (valorUnit === null || valorUnit === undefined) return null
  if (quantidade === null || quantidade === undefined) return null
  const r = valorUnit * quantidade
  return Number.isFinite(r) ? r : null
}

/** Soma dos `valor_total` de uma lista. Item sem valor conta como zero. */
export function somaItens(
  itens: Pick<Item, 'valor_total'>[],
): number {
  return itens.reduce((acc, i) => acc + (i.valor_total ?? 0), 0)
}

/** Soma das quantidades. Item sem quantidade conta como zero. */
export function somaQuantidade(
  itens: Pick<Item, 'quantidade'>[],
): number {
  return itens.reduce((acc, i) => acc + (i.quantidade ?? 0), 0)
}

/** Soma das áreas geradas. Item sem dimensão conta como zero. */
export function somaArea(itens: Pick<Item, 'area_m2'>[]): number {
  return itens.reduce((acc, i) => acc + (i.area_m2 ?? 0), 0)
}

/**
 * Os três totais do rodapé de uma vez. Existe para o rodapé não repetir
 * `reduce` por coluna — foi o que aconteceu no 5.2 e fez a soma viver em dois
 * lugares, um testado e outro não.
 */
export function totaisDosItens(
  itens: Pick<Item, 'quantidade' | 'area_m2' | 'valor_total'>[],
): { quantidade: number; area: number; valor: number; contagem: number } {
  return {
    quantidade: somaQuantidade(itens),
    area: somaArea(itens),
    valor: somaItens(itens),
    contagem: itens.length,
  }
}

// ============================================================
// Numeração
// ============================================================

/**
 * Próximo `numero` dentro de uma proposta ou contrato.
 *
 * `itens.numero` é **integer** e tem unique parcial por pai
 * (`idx_itens_numero_proposta` e `idx_itens_numero_contrato`,
 * `20260511151924_revisao_schema.sql`), então não basta `length + 1`: item
 * excluído no meio abriria buraco e a contagem colidiria. É sempre
 * `maior + 1`.
 *
 * Nulos são ignorados — convivem no unique parcial (o Postgres não deduplica
 * null) e existem de propósito: item cuja numeração no documento original não
 * era inteira ("1.1", "1A") entra com `numero: null`.
 */
export function proximoNumeroItem(
  itens: Pick<Item, 'numero'>[],
): number {
  let maior = 0
  for (const i of itens) {
    if (i.numero !== null && i.numero !== undefined && i.numero > maior) {
      maior = i.numero
    }
  }
  return maior + 1
}

/**
 * Converte o "Item: N" lido do documento para o que a coluna aceita.
 *
 * Devolve null — e não um número inventado — quando a numeração do documento
 * não é um inteiro positivo ("1.1", "1A", "—"). Inventar uma sequência faria o
 * número na tela divergir do número no PDF que o cliente tem na mão, que é
 * pior do que não ter número.
 */
export function numeroItemDoDocumento(bruto: unknown): {
  numero: number | null
  original: string | null
} {
  if (typeof bruto === 'number') {
    return Number.isInteger(bruto) && bruto > 0
      ? { numero: bruto, original: null }
      : { numero: null, original: String(bruto) }
  }

  if (typeof bruto !== 'string') return { numero: null, original: null }

  const limpo = bruto.trim()
  if (limpo === '') return { numero: null, original: null }

  if (/^\d+$/.test(limpo)) {
    const n = Number(limpo)
    // '01' e '13' aparecem assim no PDF de referência; Number cuida do zero.
    if (Number.isInteger(n) && n > 0) return { numero: n, original: null }
  }

  return { numero: null, original: limpo }
}

// ============================================================
// Valor unitário ausente
// ============================================================

/**
 * Deriva `valor_unit` quando o documento só traz o valor total da linha.
 *
 * É comum no documento real: o PDF de referência traz vários itens só com
 * "Valor total". E **é obrigatório derivar**, não opcional: como
 * `itens.valor_total` é coluna gerada de `valor_unit * quantidade`, gravar o
 * unitário nulo não "preserva" o total — apaga o valor do item, que fica nulo
 * no banco e some da soma da proposta.
 *
 * Quem não tem como derivar (`quantidade` nula ou zero, ou nenhum dos dois
 * valores) volta `ok: false`, e a decisão do chamador é mandar o documento
 * para REVISAO_HUMANA — nunca gravar zero.
 *
 * `inferido: true` pede que o chamador registre a inferência em
 * `observacao`; `notaDeInferencia` monta o texto.
 */
export function resolverValorUnit(entrada: {
  valorUnit?: number | null
  valorTotal?: number | null
  quantidade?: number | null
}):
  | { ok: true; valorUnit: number; inferido: false }
  | { ok: true; valorUnit: number; inferido: true; de: { valorTotal: number; quantidade: number } }
  | { ok: false; motivo: string } {
  const { valorUnit, valorTotal, quantidade } = entrada

  if (valorUnit !== null && valorUnit !== undefined && valorUnit > 0) {
    return { ok: true, valorUnit, inferido: false }
  }

  if (valorTotal === null || valorTotal === undefined || valorTotal <= 0) {
    return {
      ok: false,
      motivo: 'item sem valor unitário e sem valor total — nada a gravar',
    }
  }

  if (quantidade === null || quantidade === undefined || quantidade <= 0) {
    return {
      ok: false,
      motivo:
        'item só com valor total, mas quantidade ausente ou zero — não dá pra derivar o unitário',
    }
  }

  return {
    ok: true,
    valorUnit: valorTotal / quantidade,
    inferido: true,
    de: { valorTotal, quantidade },
  }
}

/** Texto padrão da inferência, para concatenar em `observacao`. */
export function notaDeInferencia(de: {
  valorTotal: number
  quantidade: number
}): string {
  return `[valor unitário inferido de ${de.valorTotal} / ${de.quantidade}]`
}

/** Junta notas a uma observação existente sem perder o que já estava lá. */
export function acrescentarObservacao(
  atual: string | null | undefined,
  nota: string,
): string {
  const base = (atual ?? '').trim()
  return base === '' ? nota : `${base} ${nota}`
}

// ============================================================
// Vínculo
// ============================================================

/**
 * `item_vinculo_xor` (`20260424121550_initial.sql`): um item NUNCA pode ter
 * `proposta_id` e `contrato_id` ao mesmo tempo. Item "solto" (os dois nulos) é
 * permitido.
 */
export function vinculoValido(
  item: Pick<ItemPayload, 'proposta_id' | 'contrato_id'>,
): boolean {
  return !(item.proposta_id && item.contrato_id)
}

// ============================================================
// Whitelist de campos de escrita
// ============================================================

/**
 * Os ÚNICOS campos que um chamador externo pode escrever num item.
 *
 * Existe por causa de um furo encontrado no bloco 5.5: as Server Actions
 * faziam `{ empresa_id, obra_id, proposta_id, ..., ...input }` — o `input`
 * vinha DEPOIS dos campos resolvidos pelo servidor. O tipo `ItemFormInput` não
 * tem `proposta_id`, mas tipo não existe em runtime: um POST podia mandar
 * `proposta_id` de outra proposta (furando a guarda de rascunho, que conferiu
 * a proposta da URL), `obra_id`, `created_by` ou `foto_url` apontando para
 * qualquer arquivo. O RLS barra outra empresa; dentro da mesma, nada barrava.
 *
 * Fora desta lista, e de propósito:
 *   - `empresa_id`, `obra_id`, `proposta_id`, `contrato_id`, `created_by` —
 *     resolvidos pelo servidor a partir da proposta e da sessão;
 *   - `valor_total`, `area_m2` — colunas GENERATED;
 *   - `foto_url` — só as actions de foto escrevem, depois de subir o arquivo;
 *   - `id`, `created_at`, `updated_at` — do banco.
 */
export const CAMPOS_EDITAVEIS_ITEM = [
  'numero',
  'tipo',
  'descricao',
  'linha',
  'acabamento',
  'localizacao',
  'vidros',
  'observacao',
  'largura',
  'altura',
  'quantidade',
  'unidade',
  'valor_unit',
] as const

export type CampoEditavelItem = (typeof CAMPOS_EDITAVEIS_ITEM)[number]

/**
 * Copia do objeto recebido SÓ os campos da whitelist, e só os presentes.
 *
 * "Só os presentes" importa: a tabela do 5.2 não manda `localizacao`,
 * `vidros` nem `observacao`, e o PostgREST só altera as colunas que estão no
 * objeto do update. Se ausente virasse `undefined` explícito — ou pior, `null`
 * — editar pela tabela apagaria o que o formulário completo gravou.
 */
export type CamposEditaveis = Partial<Pick<ItemPayload, CampoEditavelItem>>

/**
 * O tipo de retorno afirma o tipo de cada campo, e essa afirmação só vale
 * porque as actions rodam `validarEntradaItem` ANTES — é a validação que
 * garante, não o filtro. O filtro garante só QUAIS campos passam.
 */
export function camposEditaveisItem(entrada: unknown): CamposEditaveis {
  const saida: Record<string, unknown> = {}
  if (!entrada || typeof entrada !== 'object') return saida as CamposEditaveis
  const obj = entrada as Record<string, unknown>
  for (const campo of CAMPOS_EDITAVEIS_ITEM) {
    if (Object.prototype.hasOwnProperty.call(obj, campo)) saida[campo] = obj[campo]
  }
  return saida as CamposEditaveis
}

// ============================================================
// Valor da proposta × soma dos itens (bloco 5.6)
// ============================================================

/**
 * Compara o `valor_total` da proposta com a soma dos itens.
 *
 * A regra do banco (trigger `trg_itens_recalcula_pai`) é híbrida: sem itens o
 * valor é digitado; com itens ele é mantido igual à soma. Então divergência só
 * aparece por três caminhos, todos fora do app — e são eles que o aviso da
 * tela existe para expor:
 *
 *   1. dado anterior à migration do 5.6 (ela não faz backfill, de propósito);
 *   2. escrita direta em `propostas.valor_total` (n8n, SQL);
 *   3. qualquer coisa que desligue o trigger.
 *
 * Tolerância de meio centavo: `valor_total` é `numeric(14,2)` e a soma vem de
 * produtos `numeric`, mas o que chega no JavaScript é `number`.
 */
export function divergenciaDeValor(
  valorTotalProposta: number | null | undefined,
  itens: Pick<Item, 'valor_total'>[],
  desconto: number | null | undefined = 0,
): {
  temItens: boolean
  soma: number
  diferenca: number
  diverge: boolean
  /**
   * A soma dos itens ainda é menor que o desconto. É divergência ESPERADA: o
   * trigger não sincroniza nesse caso, porque gravar a soma violaria o CHECK
   * `desconto <= valor_total`. Acontece ao começar a lançar itens numa
   * proposta com desconto, e some quando a soma alcança o desconto. A tela
   * explica em vez de oferecer o botão de sincronizar, que falharia.
   */
  somaAbaixoDoDesconto: boolean
} {
  const soma = somaItens(itens)
  const valor = valorTotalProposta ?? 0
  const diferenca = Math.round((valor - soma) * 100) / 100
  const temItens = itens.length > 0
  const diverge = temItens && Math.abs(diferenca) >= 0.005
  return {
    temItens,
    soma,
    diferenca,
    // Sem itens não há o que comparar: o valor é digitado e ponto.
    diverge,
    somaAbaixoDoDesconto: diverge && soma < (desconto ?? 0),
  }
}

// ============================================================
// Duplicar, reordenar e lote (bloco 5.7)
// ============================================================

/**
 * O que a cópia leva: tudo que é editável, menos o número (a cópia recebe o
 * próximo) — e menos `foto_url`, que nem está na whitelist.
 *
 * A foto NÃO é copiada de propósito: `foto_url` é o path de UM arquivo no
 * Storage. Se as duas linhas apontassem para ele, excluir uma apagaria a foto
 * da outra (o deleteItem remove o arquivo junto).
 */
export function camposParaDuplicar(item: Pick<Item, CampoEditavelItem>): CamposEditaveis {
  const copia = camposEditaveisItem(item)
  delete copia.numero
  return copia
}

/**
 * O vizinho com quem um item troca de número ao subir ou descer.
 *
 * `itens` tem de vir na ordem da tela (numero crescente, nulos no fim). Só
 * itens COM número participam: o sem número está fora da sequência do
 * documento e fica no fim, então não sobe, não desce, e ninguém troca com ele.
 * Devolve `null` quando não há para onde ir (primeiro subindo, último descendo).
 */
export function vizinhoParaMover(
  itens: Pick<Item, 'id' | 'numero'>[],
  itemId: string,
  direcao: 'subir' | 'descer',
): string | null {
  const numerados = itens.filter((i) => i.numero !== null && i.numero !== undefined)
  const pos = numerados.findIndex((i) => i.id === itemId)
  if (pos === -1) return null
  const alvo = direcao === 'subir' ? pos - 1 : pos + 1
  return numerados[alvo]?.id ?? null
}

/** Faixa aceita pelo ajuste em lote — a mesma de `ajustar_valor_itens`. */
export const AJUSTE_MINIMO = -100
export const AJUSTE_MAXIMO = 1000

export function validarPercentual(p: unknown): string | null {
  const n = typeof p === 'string' ? Number(p.replace(',', '.')) : Number(p)
  if (p === '' || p === null || p === undefined || !Number.isFinite(n)) {
    return 'Informe o percentual'
  }
  if (n === 0) return 'Um ajuste de 0% não muda nada'
  if (n <= AJUSTE_MINIMO) return 'O ajuste tem de ser maior que -100% (o valor ficaria negativo)'
  if (n > AJUSTE_MAXIMO) return 'Ajuste acima de 1000% — confira o número'
  return null
}

/**
 * Repete `round(valor_unit * (1 + p/100), 2)` da função do banco, para a
 * PRÉVIA do diálogo. O valor que vale é o que o banco grava. O `EPSILON`
 * existe porque 1,005 em ponto flutuante é 1,00499…, e o banco (numeric
 * exato) arredonda para 1,01.
 */
export function ajustarValorUnit(valorUnit: number, percentual: number): number {
  const x = valorUnit * (1 + percentual / 100)
  return Math.round((x + Number.EPSILON) * 100) / 100
}

/** Soma antes e depois do ajuste, só dos itens escolhidos, para a prévia. */
export function previaAjuste(
  itens: Pick<Item, 'valor_unit' | 'quantidade' | 'valor_total'>[],
  percentual: number,
): { afetados: number; semValor: number; antes: number; depois: number } {
  let antes = 0
  let depois = 0
  let afetados = 0
  let semValor = 0
  for (const i of itens) {
    antes += i.valor_total ?? 0
    if (i.valor_unit === null || i.valor_unit === undefined) {
      semValor++
      continue
    }
    afetados++
    depois += ajustarValorUnit(i.valor_unit, percentual) * (i.quantidade ?? 0)
  }
  // Item sem valor entra no "depois" com o que tinha (zero).
  return {
    afetados,
    semValor,
    antes: Math.round(antes * 100) / 100,
    depois: Math.round(depois * 100) / 100,
  }
}

// ============================================================
// Pai do item: proposta ou contrato (bloco 6.4)
// ============================================================

/**
 * A quem o item pertence. Até o sprint 5 só existia proposta, e as actions de
 * item recebiam o id dela como string; desde o 6.4 o contrato reusa a mesma
 * aba, então as actions recebem o pai.
 */
export type TipoPaiItem = 'proposta' | 'contrato'
export type PaiItem = { tipo: TipoPaiItem; id: string }

/**
 * Aceita o formato novo e o antigo. **String continua valendo como proposta**:
 * é o que a camada escrita e qualquer chamador de antes do 6.4 mandam, e a
 * Server Action é um POST que qualquer um pode chamar — o formato velho não
 * pode virar erro. Qualquer outra coisa (tipo desconhecido, id vazio) é
 * recusada: `null`.
 */
export function normalizarPai(pai: unknown): PaiItem | null {
  if (typeof pai === 'string') return pai ? { tipo: 'proposta', id: pai } : null
  if (!pai || typeof pai !== 'object') return null
  const { tipo, id } = pai as Record<string, unknown>
  if ((tipo !== 'proposta' && tipo !== 'contrato') || typeof id !== 'string' || !id) {
    return null
  }
  return { tipo, id }
}

/** A coluna de `itens` que aponta para o pai. O XOR garante que é uma só. */
export function colunaDoPai(tipo: TipoPaiItem): 'proposta_id' | 'contrato_id' {
  return tipo === 'proposta' ? 'proposta_id' : 'contrato_id'
}

/** A rota de detalhe do pai — o que as actions revalidam. */
export function rotaDoPai(pai: PaiItem): string {
  return `/${pai.tipo === 'proposta' ? 'propostas' : 'contratos'}/${pai.id}`
}

/** Os textos que mudam com o pai, pra aba falar "desta proposta" ou "deste contrato". */
export const TEXTOS_PAI: Record<
  TipoPaiItem,
  { nome: string; o: string; deste: string; neste: string; foraDeEdicao: string }
> = {
  proposta: {
    nome: 'proposta',
    o: 'a',
    deste: 'desta proposta',
    neste: 'nesta proposta',
    foraDeEdicao: 'Proposta fora de rascunho: os itens não podem mais ser alterados',
  },
  contrato: {
    nome: 'contrato',
    o: 'o',
    deste: 'deste contrato',
    neste: 'neste contrato',
    foraDeEdicao: 'Contrato não está ativo: os itens não podem mais ser alterados',
  },
}
