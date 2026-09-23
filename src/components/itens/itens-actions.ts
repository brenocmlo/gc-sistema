'use server'

import { revalidatePath } from 'next/cache'

import {
  camposEditaveisItem,
  camposParaDuplicar,
  isUnidade,
  limparColunasGeradas,
  proximoNumeroItem,
  somaItens,
  validarPercentual,
  vinculoValido,
  vizinhoParaMover,
} from '@/lib/itens'
import { buildStoragePath } from '@/lib/files'
import {
  BUCKET_FOTOS,
  pathEhDoItem,
  removeuTudo,
  validarFoto,
} from '@/lib/fotos'
import { isEditavel } from '@/lib/propostas'
import { createClient } from '@/lib/supabase/server'
import type { Item, ItemPayload, PropostaStatus, Unidade } from '@/lib/types'

// ============================================================
// Guard
// ============================================================

type Autorizacao =
  | { ok: true; userId: string; empresaId: string; obraId: string }
  | { ok: false; error: string }

/**
 * Guard das actions de item. Repete a checagem de perfil por conta própria —
 * guard de layout protege rota, não ação (CLAUDE.md) — e faz mais duas coisas
 * que só o item precisa:
 *
 * 1. **Resolve `obra_id` a partir da proposta**, em vez de aceitar do cliente.
 *    `itens` tem FK composta `(proposta_id, empresa_id, obra_id)` → a obra do
 *    item TEM de ser a mesma da proposta. Aceitar `obra_id` do formulário
 *    deixaria a integridade nas mãos do navegador.
 * 2. **Recusa item em proposta que não é rascunho.** Mesma regra do botão
 *    Editar (`isEditavel`): proposta enviada ou decidida é documento fechado,
 *    e mexer nos itens mudaria o valor por baixo de uma proposta que o cliente
 *    já recebeu.
 */
async function autorizarItem(
  supabase: ReturnType<typeof createClient>,
  propostaId: string,
  acao: string,
  /**
   * Quem pode. O default espelha as policies de insert/update de `itens`
   * (admin e comercial). Exclusão passa `['admin']`, porque a policy
   * "Itens: admin exclui" só deixa admin — ver `deleteItem`.
   */
  perfis: readonly string[] = ['admin', 'comercial'],
): Promise<Autorizacao> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Não autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('empresa_id, perfil')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) return { ok: false, error: 'Perfil não configurado' }

  if (!perfis.includes(profile.perfil)) {
    return { ok: false, error: `Sem permissão pra ${acao}` }
  }

  const { data: proposta } = await supabase
    .from('propostas')
    .select('id, obra_id, empresa_id, status')
    .eq('id', propostaId)
    .maybeSingle()

  if (!proposta) return { ok: false, error: 'Proposta não encontrada' }

  if (!isEditavel(proposta.status as PropostaStatus)) {
    return {
      ok: false,
      error: 'Proposta fora de rascunho: os itens não podem mais ser alterados',
    }
  }

  return {
    ok: true,
    userId: user.id,
    empresaId: proposta.empresa_id,
    obraId: proposta.obra_id,
  }
}

/**
 * Traduz erro do Postgres para algo que a pessoa entenda, no mesmo espírito
 * de `mensagemDeErroProposta`. As três primeiras são as que o schema de
 * `itens` produz de verdade.
 */
/**
 * Valida o que chegou pela rede. `ItemFormInput` diz que `unidade` é
 * `Unidade | null`, mas o tipo só vale de dentro do TypeScript: a action é um
 * POST, e a automação da Fase 6 vai chamá-la de fora. Sem isto, `unidade:'ML'`
 * ia até o banco e voltava como erro de constraint — funciona, mas gasta uma
 * ida ao Postgres para dizer o que dá pra dizer aqui.
 */
function validarEntradaItem(input: ItemFormInput): string | null {
  if (input.unidade !== null && !isUnidade(input.unidade)) {
    return 'Unidade inválida: use Quantidade (un) ou Metro quadrado (m²)'
  }
  if (input.numero !== null && !Number.isInteger(input.numero)) {
    return 'O número do item tem de ser inteiro'
  }
  for (const [campo, rotulo, g] of [
    ['quantidade', 'Quantidade', 'a'],
    ['largura', 'Largura', 'a'],
    ['altura', 'Altura', 'a'],
    ['valor_unit', 'Valor unitário', 'o'],
  ] as const) {
    const v = input[campo]
    if (v !== null && (!Number.isFinite(v) || v < 0)) {
      return `${rotulo} não pode ser negativ${g} nem inválid${g}`
    }
  }
  return null
}

function mensagemDeErroItem(raw: string): string {
  if (raw.includes('idx_itens_numero_proposta')) {
    return 'Já existe um item com esse número nesta proposta'
  }
  if (raw.includes('itens_unidade_check')) {
    return 'Unidade inválida: use Quantidade (un) ou Metro quadrado (m²)'
  }
  if (raw.includes('item_vinculo_xor')) {
    return 'Item não pode pertencer a uma proposta e a um contrato ao mesmo tempo'
  }
  if (raw.includes('non-DEFAULT value into column')) {
    // valor_total e area_m2 são GENERATED. ItemPayload já bloqueia no tsc;
    // se chegou aqui, alguém montou o payload fora do tipo.
    return 'Valor total e área são calculados pelo sistema e não podem ser enviados'
  }
  if (raw.includes('itens_obra_fk') || raw.includes('itens_proposta_fk')) {
    return 'Vínculo inválido entre item, proposta e obra'
  }
  return raw
}

// ============================================================
// Tipos de entrada — o que a tabela manda
// ============================================================

/**
 * Campos editáveis na tabela. Note o que NÃO está aqui: `valor_total` e
 * `area_m2` (colunas geradas), `empresa_id` e `obra_id` (resolvidos do
 * servidor), `proposta_id` (vem do parâmetro).
 */
export type ItemFormInput = {
  numero: number | null
  tipo: string | null
  descricao: string | null
  linha: string | null
  acabamento: string | null
  largura: number | null
  altura: number | null
  quantidade: number | null
  unidade: Unidade | null
  valor_unit: number | null
  /**
   * Campos do formulário completo (bloco 5.3). **Opcionais de propósito.**
   *
   * A tabela inline do 5.2 não os envia, e o PostgREST só altera as colunas
   * presentes no objeto do update — então omitir PRESERVA o que está no banco.
   * Se fossem obrigatórios, editar uma linha pela tabela apagaria a observação
   * que alguém escreveu no formulário completo.
   */
  localizacao?: string | null
  vidros?: string | null
  observacao?: string | null
}

export type ItemActionResult =
  | { ok: true; item: Item }
  | { ok: false; error: string }

export type DeleteItemResult = { ok: true } | { ok: false; error: string }

const CAMPOS_ITEM =
  'id, empresa_id, obra_id, proposta_id, contrato_id, numero, tipo, descricao, linha, acabamento, largura, altura, quantidade, unidade, valor_unit, valor_total, area_m2, vidros, localizacao, observacao, foto_url, created_at, updated_at, created_by'

// ============================================================
// Criar
// ============================================================

export async function createItem(
  propostaId: string,
  input: ItemFormInput,
): Promise<ItemActionResult> {
  const supabase = createClient()

  const auth = await autorizarItem(supabase, propostaId, 'criar itens')
  if (!auth.ok) return { ok: false, error: auth.error }

  const invalido = validarEntradaItem(input)
  if (invalido) return { ok: false, error: invalido }

  // Campos do chamador PRIMEIRO, filtrados pela whitelist; os do servidor
  // DEPOIS, para que nenhum POST consiga sobrescrevê-los. A ordem inversa foi
  // o furo encontrado no bloco 5.5 — ver `CAMPOS_EDITAVEIS_ITEM`.
  const payload: ItemPayload = {
    ...camposEditaveisItem(input),
    empresa_id: auth.empresaId,
    obra_id: auth.obraId,
    proposta_id: propostaId,
    contrato_id: null,
    created_by: auth.userId,
  }

  if (!vinculoValido(payload)) {
    return {
      ok: false,
      error: 'Item não pode pertencer a uma proposta e a um contrato ao mesmo tempo',
    }
  }

  // Segunda barreira: ItemPayload já removeu as colunas geradas em tempo de
  // compilação, mas `input` atravessa a fronteira de rede e pode trazer
  // qualquer coisa.
  const limpo = limparColunasGeradas(payload)

  const { data, error } = await supabase
    .from('itens')
    .insert(limpo)
    .select(CAMPOS_ITEM)
    .single()

  if (error) return { ok: false, error: mensagemDeErroItem(error.message) }

  revalidatePath(`/propostas/${propostaId}`)
  return { ok: true, item: data as Item }
}

// ============================================================
// Editar
// ============================================================

export async function updateItem(
  propostaId: string,
  itemId: string,
  input: ItemFormInput,
  /**
   * `updated_at` que o cliente tinha quando começou a editar. Lock otimista:
   * se outra pessoa gravou nessa linha no meio, o update não casa e a edição
   * é recusada em vez de sobrescrever em silêncio.
   *
   * Opcional para não quebrar chamador que ainda não manda — mas a tabela
   * manda, e sem ele a última gravação vence.
   */
  updatedAtVisto?: string | null,
): Promise<ItemActionResult> {
  const supabase = createClient()

  const auth = await autorizarItem(supabase, propostaId, 'editar itens')
  if (!auth.ok) return { ok: false, error: auth.error }

  const invalido = validarEntradaItem(input)
  if (invalido) return { ok: false, error: invalido }

  // Só a whitelist chega ao update. Sem isso, `proposta_id` no corpo movia o
  // item para outra proposta — inclusive uma fora de rascunho.
  const limpo = camposEditaveisItem(input)

  // `.eq('proposta_id')` não é redundante com o id: impede editar, por id, um
  // item que pertence a outra proposta.
  let q = supabase
    .from('itens')
    .update(limpo)
    .eq('id', itemId)
    .eq('proposta_id', propostaId)

  if (updatedAtVisto) q = q.eq('updated_at', updatedAtVisto)

  const { data, error } = await q.select(CAMPOS_ITEM).maybeSingle()

  if (error) return { ok: false, error: mensagemDeErroItem(error.message) }

  if (!data) {
    // Zero linha com lock: ou o item sumiu, ou alguém gravou antes. Distinguir
    // os dois casos importa, porque a mensagem muda o que a pessoa faz.
    if (updatedAtVisto) {
      const { data: atual } = await supabase
        .from('itens')
        .select('updated_at')
        .eq('id', itemId)
        .eq('proposta_id', propostaId)
        .maybeSingle()

      if (atual && atual.updated_at !== updatedAtVisto) {
        return {
          ok: false,
          error:
            'Este item foi alterado por outra pessoa enquanto você editava. A tabela foi recarregada — confira antes de repetir.',
        }
      }
    }
    return { ok: false, error: 'Item não encontrado nesta proposta' }
  }

  revalidatePath(`/propostas/${propostaId}`)
  return { ok: true, item: data as Item }
}

// ============================================================
// Excluir
// ============================================================

export async function deleteItem(
  propostaId: string,
  itemId: string,
): Promise<DeleteItemResult> {
  const supabase = createClient()

  // Só admin: é o que a policy "Itens: admin exclui" permite. Até o bloco 5.5
  // este guard aceitava comercial, a policy negava EM SILÊNCIO (delete com RLS
  // negando devolve 0 linhas, não erro) e a action respondia `ok` — a tela
  // mostrava "Item excluído" e o item continuava lá.
  const auth = await autorizarItem(supabase, propostaId, 'excluir itens', ['admin'])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { data: item } = await supabase
    .from('itens')
    .select('id, foto_url')
    .eq('id', itemId)
    .eq('proposta_id', propostaId)
    .maybeSingle()
  if (!item) return { ok: false, error: 'Item não encontrado nesta proposta' }

  // `.select()` depois do delete devolve as linhas apagadas: é o único jeito
  // de distinguir "apagou" de "o RLS não deixou".
  const { data: apagados, error } = await supabase
    .from('itens')
    .delete()
    .eq('id', itemId)
    .eq('proposta_id', propostaId)
    .select('id')

  if (error) return { ok: false, error: mensagemDeErroItem(error.message) }
  if (!apagados || apagados.length === 0) {
    return { ok: false, error: 'O item não pôde ser excluído (sem permissão ou já removido)' }
  }

  // A foto vai junto. Depois do delete, e não antes: se a foto sumisse e o
  // delete falhasse, o item ficaria apontando para um arquivo inexistente.
  // Admin pode remover qualquer arquivo da empresa, então aqui não há o caso
  // do "dono" que a substituição de foto tem de tratar.
  if (item.foto_url && pathEhDoItem(item.foto_url, auth.empresaId, itemId)) {
    await supabase.storage.from(BUCKET_FOTOS).remove([item.foto_url])
  }

  revalidatePath(`/propostas/${propostaId}`)
  return { ok: true }
}

// ============================================================
// Foto do item (bloco 5.5)
// ============================================================

export type FotoItemResult =
  | { ok: true; fotoUrl: string | null }
  | { ok: false; error: string }

/**
 * Sobe (ou substitui) a foto do item.
 *
 * A ordem é o que mantém banco e bucket consistentes em qualquer falha:
 *
 *   1. sobe o arquivo NOVO num path novo (timestamp no nome, nunca colide);
 *   2. troca o ponteiro `foto_url` para o novo;
 *   3. remove o ANTIGO.
 *
 * Se (2) falha, remove o novo e nada mudou. Se (3) é negado pelo RLS do
 * Storage — a policy de delete do bucket é **admin ou dono do arquivo**, então
 * comercial B não remove a foto que comercial A enviou — o ponteiro volta ao
 * antigo e o novo é removido: a substituição é recusada inteira, em vez de
 * deixar um arquivo órfão que ninguém vê e ninguém consegue apagar pela tela.
 */
export async function uploadFotoItem(
  propostaId: string,
  itemId: string,
  formData: FormData,
): Promise<FotoItemResult> {
  const file = formData.get('file')
  if (!(file instanceof File)) return { ok: false, error: 'Arquivo ausente no upload' }

  const invalida = validarFoto(file)
  if (invalida) return { ok: false, error: invalida }

  const supabase = createClient()
  const auth = await autorizarItem(supabase, propostaId, 'alterar a foto do item')
  if (!auth.ok) return { ok: false, error: auth.error }

  const { data: item } = await supabase
    .from('itens')
    .select('id, foto_url')
    .eq('id', itemId)
    .eq('proposta_id', propostaId)
    .maybeSingle()
  if (!item) return { ok: false, error: 'Item não encontrado nesta proposta' }

  const anterior = item.foto_url
  const novo = buildStoragePath(auth.empresaId, 'itens', itemId, file.name)

  // 1. arquivo novo
  const { error: upErr } = await supabase.storage
    .from(BUCKET_FOTOS)
    .upload(novo, file, { contentType: file.type, upsert: false })
  if (upErr) return { ok: false, error: upErr.message }

  // 2. ponteiro
  const { data: trocado, error: updErr } = await supabase
    .from('itens')
    .update({ foto_url: novo })
    .eq('id', itemId)
    .eq('proposta_id', propostaId)
    .select('id')
  if (updErr || !trocado || trocado.length === 0) {
    await supabase.storage.from(BUCKET_FOTOS).remove([novo])
    return { ok: false, error: updErr?.message ?? 'Não foi possível gravar a foto no item' }
  }

  // 3. arquivo antigo
  if (anterior && pathEhDoItem(anterior, auth.empresaId, itemId)) {
    const { data: removidos } = await supabase.storage
      .from(BUCKET_FOTOS)
      .remove([anterior])

    if (!removeuTudo([anterior], removidos)) {
      // Desfaz: ponteiro volta, arquivo novo sai.
      await supabase
        .from('itens')
        .update({ foto_url: anterior })
        .eq('id', itemId)
        .eq('proposta_id', propostaId)
      await supabase.storage.from(BUCKET_FOTOS).remove([novo])
      return {
        ok: false,
        error: 'Só quem enviou a foto atual ou um admin pode substituí-la',
      }
    }
  }

  revalidatePath(`/propostas/${propostaId}`)
  return { ok: true, fotoUrl: novo }
}

/** Remove a foto do item. Mesma regra de dono do Storage da substituição. */
export async function removerFotoItem(
  propostaId: string,
  itemId: string,
): Promise<FotoItemResult> {
  const supabase = createClient()
  const auth = await autorizarItem(supabase, propostaId, 'remover a foto do item')
  if (!auth.ok) return { ok: false, error: auth.error }

  const { data: item } = await supabase
    .from('itens')
    .select('id, foto_url')
    .eq('id', itemId)
    .eq('proposta_id', propostaId)
    .maybeSingle()
  if (!item) return { ok: false, error: 'Item não encontrado nesta proposta' }
  if (!item.foto_url) return { ok: true, fotoUrl: null }

  // Storage primeiro: se o RLS negar, o ponteiro continua certo.
  if (pathEhDoItem(item.foto_url, auth.empresaId, itemId)) {
    const { data: removidos } = await supabase.storage
      .from(BUCKET_FOTOS)
      .remove([item.foto_url])
    if (!removeuTudo([item.foto_url], removidos)) {
      return { ok: false, error: 'Só quem enviou a foto ou um admin pode removê-la' }
    }
  }

  const { error } = await supabase
    .from('itens')
    .update({ foto_url: null })
    .eq('id', itemId)
    .eq('proposta_id', propostaId)
  if (error) return { ok: false, error: mensagemDeErroItem(error.message) }

  revalidatePath(`/propostas/${propostaId}`)
  return { ok: true, fotoUrl: null }
}

export type ImportarItensResult =
  | { ok: true; importados: number; ignorados: number }
  | { ok: false; error: string }

/**
 * Grava em lote as linhas que o preview aprovou.
 *
 * **Transação:** o PostgREST executa um `insert` com array de linhas como UMA
 * instrução, então ou entram todas ou nenhuma — é a transação que o enunciado
 * pede, sem função SQL. Se uma linha violar o unique parcial de `numero`, o
 * lote inteiro volta atrás, e é o comportamento desejado: importação
 * parcialmente aplicada é pior que importação recusada, porque ninguém sabe
 * onde parou.
 *
 * **Numeração automática:** linha sem `numero` recebe `maior + 1` a partir do
 * que já existe na proposta, continuando a sequência dentro do próprio lote.
 * Usa `proximoNumeroItem`, o mesmo helper da tabela do 5.2.
 *
 * `ignorados` é informação do chamador — as linhas que o preview marcou com
 * erro e a pessoa optou por não corrigir. Elas nem chegam aqui; o número vem
 * junto só para o relatório final.
 */
export async function importarItens(
  propostaId: string,
  linhas: ItemFormInput[],
  ignorados: number,
): Promise<ImportarItensResult> {
  const supabase = createClient()

  const auth = await autorizarItem(supabase, propostaId, 'importar itens')
  if (!auth.ok) return { ok: false, error: auth.error }

  if (linhas.length === 0) {
    return { ok: false, error: 'Nenhuma linha válida para importar' }
  }

  // Limite defensivo: o corpo da Server Action é serializado, e planilha de
  // 10 mil linhas travaria o navegador antes de chegar ao banco.
  if (linhas.length > 500) {
    return {
      ok: false,
      error: `Importação de ${linhas.length} itens é grande demais; divida em arquivos de até 500 linhas`,
    }
  }

  for (const linha of linhas) {
    const invalido = validarEntradaItem(linha)
    if (invalido) return { ok: false, error: `Linha recusada: ${invalido}` }
  }

  // Numeração automática para as linhas sem número, continuando a sequência
  // da proposta e do próprio lote.
  const { data: existentes, error: erroLeitura } = await supabase
    .from('itens')
    .select('numero')
    .eq('proposta_id', propostaId)

  if (erroLeitura) {
    return { ok: false, error: mensagemDeErroItem(erroLeitura.message) }
  }

  const numerados = [...((existentes ?? []) as { numero: number | null }[])]
  const payloads: ItemPayload[] = []

  for (const linha of linhas) {
    const numero =
      linha.numero ?? proximoNumeroItem([...numerados, ...payloads.map((p) => ({ numero: p.numero ?? null }))])

    payloads.push(
      {
        ...camposEditaveisItem(linha),
        numero,
        empresa_id: auth.empresaId,
        obra_id: auth.obraId,
        proposta_id: propostaId,
        contrato_id: null,
        created_by: auth.userId,
      } as ItemPayload,
    )
  }

  const { data, error } = await supabase
    .from('itens')
    .insert(payloads)
    .select('id')

  if (error) return { ok: false, error: mensagemDeErroItem(error.message) }

  revalidatePath(`/propostas/${propostaId}`)
  return { ok: true, importados: data?.length ?? 0, ignorados }
}

// ============================================================
// Divergência valor × itens (bloco 5.6)
// ============================================================

export type SincronizarValorResult =
  | { ok: true; valorTotal: number }
  | { ok: false; error: string }

/**
 * Faz o `valor_total` da proposta voltar a ser a soma dos itens.
 *
 * É a resolução do aviso de divergência. O trigger mantém a soma a cada
 * mudança de item, então divergência só existe por dado anterior à migration
 * do 5.6 (que não fez backfill, de propósito) ou por escrita direta no valor
 * da proposta. A migration não corrige isso sozinha porque corrigir é mudar
 * valor comercial: aqui é a pessoa que decide, pelo botão.
 */
export async function sincronizarValorComItens(
  propostaId: string,
): Promise<SincronizarValorResult> {
  const supabase = createClient()
  const auth = await autorizarItem(supabase, propostaId, 'ajustar o valor da proposta')
  if (!auth.ok) return { ok: false, error: auth.error }

  const [{ data: itens }, { data: proposta }] = await Promise.all([
    supabase.from('itens').select('valor_total').eq('proposta_id', propostaId),
    supabase.from('propostas').select('desconto').eq('id', propostaId).maybeSingle(),
  ])

  if (!itens || itens.length === 0) {
    return { ok: false, error: 'A proposta não tem itens: o valor total é digitado' }
  }

  const soma = somaItens(itens as { valor_total: number | null }[])
  if (soma < Number(proposta?.desconto ?? 0)) {
    return {
      ok: false,
      error: 'O desconto da proposta é maior que a soma dos itens. Reduza o desconto antes.',
    }
  }

  const { error } = await supabase
    .from('propostas')
    .update({ valor_total: soma })
    .eq('id', propostaId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/propostas/${propostaId}`)
  return { ok: true, valorTotal: soma }
}

// ============================================================
// Duplicar, reordenar e lote (bloco 5.7)
// ============================================================

export type AcaoEmLoteResult =
  | { ok: true; afetados: number }
  | { ok: false; error: string }

/** Mensagens das funções `trocar_numero_itens` e `ajustar_valor_itens`. */
function mensagemDeErroLote(raw: string): string {
  if (raw.includes('itens_proposta_fora_de_rascunho')) {
    return 'Proposta fora de rascunho: os itens não podem mais ser alterados'
  }
  if (raw.includes('itens_troca_sem_numero')) {
    return 'Item sem número não entra na ordenação: dê um número a ele primeiro'
  }
  if (raw.includes('itens_troca_nao_gravou') || raw.includes('itens_troca_nao_encontrado')) {
    return 'Não foi possível reordenar (sem permissão ou item já removido)'
  }
  if (raw.includes('itens_ajuste_percentual_invalido')) {
    return 'Percentual inválido: tem de ser maior que -100% e no máximo 1000%'
  }
  return mensagemDeErroItem(raw)
}

/** Ids que o chamador mandou, filtrados para os que são desta proposta. */
async function idsDaProposta(
  supabase: ReturnType<typeof createClient>,
  propostaId: string,
  ids: unknown,
): Promise<string[]> {
  if (!Array.isArray(ids) || ids.length === 0) return []
  const texto = ids.filter((i): i is string => typeof i === 'string').slice(0, 500)
  const { data } = await supabase
    .from('itens')
    .select('id')
    .eq('proposta_id', propostaId)
    .in('id', texto)
  return (data ?? []).map((i) => i.id)
}

/**
 * Duplica um item: copia os campos editáveis e dá à cópia o próximo número
 * (`maior + 1`, no fim da lista). A foto não vai — ver `camposParaDuplicar`.
 */
export async function duplicarItem(
  propostaId: string,
  itemId: string,
): Promise<ItemActionResult> {
  const supabase = createClient()
  const auth = await autorizarItem(supabase, propostaId, 'duplicar itens')
  if (!auth.ok) return { ok: false, error: auth.error }

  const [{ data: original }, { data: todos }] = await Promise.all([
    supabase.from('itens').select(CAMPOS_ITEM).eq('id', itemId).eq('proposta_id', propostaId).maybeSingle(),
    supabase.from('itens').select('numero').eq('proposta_id', propostaId),
  ])
  if (!original) return { ok: false, error: 'Item não encontrado nesta proposta' }

  const payload: ItemPayload = {
    ...camposParaDuplicar(original as Item),
    numero: proximoNumeroItem((todos ?? []) as { numero: number | null }[]),
    empresa_id: auth.empresaId,
    obra_id: auth.obraId,
    proposta_id: propostaId,
    contrato_id: null,
    created_by: auth.userId,
  }

  const { data, error } = await supabase.from('itens').insert(payload).select(CAMPOS_ITEM).single()
  if (error) return { ok: false, error: mensagemDeErroItem(error.message) }

  revalidatePath(`/propostas/${propostaId}`)
  return { ok: true, item: data as Item }
}

/**
 * Sobe ou desce um item uma posição, trocando o número com o vizinho.
 *
 * O vizinho é calculado AQUI, a partir do banco — a tela manda só o item e a
 * direção. Aceitar "troque com este outro id" do cliente deixaria trocar com
 * qualquer item, inclusive de outra proposta. A troca em si é
 * `trocar_numero_itens`, que faz os três passos numa transação.
 */
export async function moverItem(
  propostaId: string,
  itemId: string,
  direcao: 'subir' | 'descer',
): Promise<AcaoEmLoteResult> {
  if (direcao !== 'subir' && direcao !== 'descer') {
    return { ok: false, error: 'Direção inválida' }
  }
  const supabase = createClient()
  const auth = await autorizarItem(supabase, propostaId, 'reordenar itens')
  if (!auth.ok) return { ok: false, error: auth.error }

  const { data: todos } = await supabase
    .from('itens')
    .select('id, numero')
    .eq('proposta_id', propostaId)
    .order('numero', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })

  const lista = (todos ?? []) as { id: string; numero: number | null }[]
  const alvo = lista.find((i) => i.id === itemId)
  if (!alvo) return { ok: false, error: 'Item não encontrado nesta proposta' }
  if (alvo.numero === null) {
    return { ok: false, error: 'Item sem número não entra na ordenação: dê um número a ele primeiro' }
  }
  const vizinho = vizinhoParaMover(lista, itemId, direcao)
  if (!vizinho) {
    return { ok: false, error: direcao === 'subir' ? 'O item já é o primeiro' : 'O item já é o último' }
  }

  const { error } = await supabase.rpc('trocar_numero_itens', { p_item_a: itemId, p_item_b: vizinho })
  if (error) return { ok: false, error: mensagemDeErroLote(error.message) }

  revalidatePath(`/propostas/${propostaId}`)
  return { ok: true, afetados: 2 }
}

/**
 * Exclui vários itens de uma vez. Só admin — a mesma policy do delete
 * unitário. Uma instrução só: ou saem todos, ou nenhum. As fotos saem depois,
 * pelo mesmo motivo do `deleteItem`.
 */
export async function excluirItensEmLote(
  propostaId: string,
  itemIds: string[],
): Promise<AcaoEmLoteResult> {
  const supabase = createClient()
  const auth = await autorizarItem(supabase, propostaId, 'excluir itens', ['admin'])
  if (!auth.ok) return { ok: false, error: auth.error }

  const ids = await idsDaProposta(supabase, propostaId, itemIds)
  if (ids.length === 0) return { ok: false, error: 'Nenhum item desta proposta foi selecionado' }

  const { data: comFoto } = await supabase
    .from('itens').select('id, foto_url').in('id', ids).not('foto_url', 'is', null)

  const { data: apagados, error } = await supabase
    .from('itens').delete().eq('proposta_id', propostaId).in('id', ids).select('id')
  if (error) return { ok: false, error: mensagemDeErroItem(error.message) }
  if (!apagados || apagados.length === 0) {
    return { ok: false, error: 'Os itens não puderam ser excluídos (sem permissão ou já removidos)' }
  }

  const paths = (comFoto ?? [])
    .filter((i) => pathEhDoItem(i.foto_url, auth.empresaId, i.id))
    .map((i) => i.foto_url as string)
  if (paths.length > 0) await supabase.storage.from(BUCKET_FOTOS).remove(paths)

  revalidatePath(`/propostas/${propostaId}`)
  return { ok: true, afetados: apagados.length }
}

/**
 * Ajusta o valor unitário dos itens escolhidos em um percentual ("+5%").
 * Uma instrução só, na função `ajustar_valor_itens`, que também confere o
 * rascunho. Item sem valor unitário fica como está.
 */
export async function ajustarValorEmLote(
  propostaId: string,
  itemIds: string[],
  percentual: number,
): Promise<AcaoEmLoteResult> {
  const invalido = validarPercentual(percentual)
  if (invalido) return { ok: false, error: invalido }

  const supabase = createClient()
  const auth = await autorizarItem(supabase, propostaId, 'ajustar valores')
  if (!auth.ok) return { ok: false, error: auth.error }

  const ids = await idsDaProposta(supabase, propostaId, itemIds)
  if (ids.length === 0) return { ok: false, error: 'Nenhum item desta proposta foi selecionado' }

  const { data, error } = await supabase.rpc('ajustar_valor_itens', {
    p_proposta: propostaId,
    p_itens: ids,
    p_percentual: percentual,
  })
  if (error) return { ok: false, error: mensagemDeErroLote(error.message) }

  revalidatePath(`/propostas/${propostaId}`)
  return { ok: true, afetados: Number(data ?? 0) }
}
