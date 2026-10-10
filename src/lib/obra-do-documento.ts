// Qual obra um documento é (decisão 27, Breno em 25/09): o bot lê o PDF e a
// obra sai do conteúdo — código, nome, cliente —, não do cadastro de quem
// mandou. O contato só autoriza o envio e diz a empresa.
//
// Regra: só aceita um resultado ÚNICO. Dúvida (nada bateu, ou bateu mais de
// uma obra) vira revisão humana com as candidatas, nunca um chute.
// Puro — sem Supabase — pra ser testável por node --test; as rotas de
// ingestão consultam as obras e chamam isto.

export type ObraCandidata = {
  id: string
  codigo_obra: string | null
  nome: string | null
  cliente_nome?: string | null
}

/** O que a leitura do PDF achou sobre a obra. Tudo opcional. */
export type PistasDeObra = {
  codigo?: unknown
  nome?: unknown
  cliente?: unknown
}

export type ObraIdentificada =
  | { ok: true; obraId: string; como: 'codigo' | 'nome' | 'cliente' }
  | { ok: false; motivo: string; candidatas: string[] }

/** Minúsculo, sem acento, só letras e números separados por um espaço. */
export function normalizarTexto(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Código sem separadores: "OBRA-2025-03", "obra 2025 03" e "OBRA202503" batem. */
function normalizarCodigo(v: unknown): string {
  return normalizarTexto(v).replace(/ /g, '')
}

const NOME_MIN = 6

function rotulo(o: ObraCandidata): string {
  return [o.codigo_obra, o.nome].filter(Boolean).join(' — ') || o.id
}

function unica(lista: ObraCandidata[], como: 'codigo' | 'nome' | 'cliente'): ObraIdentificada | null {
  if (lista.length === 1) return { ok: true, obraId: lista[0].id, como }
  if (lista.length > 1) {
    return {
      ok: false,
      motivo: `o documento combina com mais de uma obra (${lista.map(rotulo).join('; ')})`,
      candidatas: lista.map((o) => o.id),
    }
  }
  return null
}

export function identificarObra(obras: ObraCandidata[], pistas: PistasDeObra): ObraIdentificada {
  const codigo = normalizarCodigo(pistas.codigo)
  const nome = normalizarTexto(pistas.nome)
  const cliente = normalizarTexto(pistas.cliente)

  if (!codigo && !nome && !cliente) {
    return { ok: false, motivo: 'o documento não traz o código nem o nome da obra', candidatas: [] }
  }

  // 1. Código: igual, ou o código cadastrado aparece dentro do lido
  //    ("Obra: OBRA-2025-03 - Teste" traz o código junto do nome).
  if (codigo) {
    const r = unica(
      obras.filter((o) => {
        const c = normalizarCodigo(o.codigo_obra)
        return c.length >= 3 && (c === codigo || codigo.includes(c))
      }),
      'codigo',
    )
    if (r) return r
  }

  // 2. Nome: igual, ou um contém o outro (com tamanho mínimo, pra "obra" não
  //    bater em tudo). O lido costuma vir mais longo ("ESTAÇÃO FASHION - FACHADA").
  const textoNome = [nome, normalizarTexto(pistas.codigo)].filter(Boolean).join(' ')
  if (textoNome) {
    const iguais = obras.filter((o) => normalizarTexto(o.nome) !== '' && normalizarTexto(o.nome) === nome)
    const r1 = unica(iguais, 'nome')
    if (r1) return r1
    const contidos = obras.filter((o) => {
      const n = normalizarTexto(o.nome)
      if (n.length < NOME_MIN) return false
      return textoNome.includes(n) || (nome.length >= NOME_MIN && n.includes(nome))
    })
    const r2 = unica(contidos, 'nome')
    if (r2) return r2
  }

  // 3. Cliente: só quando o cliente tem UMA obra — com duas, não há como saber.
  if (cliente) {
    const r = unica(
      obras.filter((o) => {
        const c = normalizarTexto(o.cliente_nome)
        return c.length >= NOME_MIN && (c === cliente || cliente.includes(c) || c.includes(cliente))
      }),
      'cliente',
    )
    if (r) return r
  }

  const lido = [pistas.codigo, pistas.nome].filter((x) => typeof x === 'string' && x.trim()).join(' · ')
  return {
    ok: false,
    motivo: `não encontramos no sistema a obra do documento${lido ? ` (${lido})` : ''}`,
    candidatas: [],
  }
}

// ============================================================
// Pergunta da obra pelo bot (decisão 31, Breno em 07/10)
// ============================================================
// Obra não identificada deixa de ir direto para revisão: o bot manda uma
// lista numerada ("1) …, 2) …, 0) nenhuma delas") e a pessoa responde com o
// número. O nó de Telegram do n8n só monta botões em quantidade fixa, por
// isso a lista é texto. As opções ficam gravadas no documento
// (documentos_processamento.opcoes_obra) para a resposta ser conferida contra
// o que foi perguntado, não contra o cadastro de agora.

export type OpcaoDeObra = { id: string; rotulo: string }

export const MAX_OPCOES_OBRA = 8

export function rotuloDaObra(o: Pick<ObraCandidata, 'codigo_obra' | 'nome'>): string {
  return [o.codigo_obra, o.nome].filter(Boolean).join(' — ') || 'obra sem nome'
}

/**
 * As candidatas da identificação, quando houve empate; senão as obras da
 * empresa (a ordem de quem chama: a mais recente primeiro). No máximo 8 — a
 * lista inteira não cabe numa mensagem legível.
 */
export function opcoesParaPergunta(obras: ObraCandidata[], candidatas: string[]): OpcaoDeObra[] {
  const empatadas = candidatas.length ? obras.filter((o) => candidatas.includes(o.id)) : []
  const base = empatadas.length ? empatadas : obras
  return base.slice(0, MAX_OPCOES_OBRA).map((o) => ({ id: o.id, rotulo: rotuloDaObra(o) }))
}

export function textoDaPergunta(opcoes: OpcaoDeObra[]): string {
  const linhas = opcoes.map((o, i) => `${i + 1}) ${o.rotulo}`)
  return [
    'De qual obra é este documento? Responda só com o número:',
    ...linhas,
    '0) Nenhuma destas (a equipe cadastra e registra)',
  ].join('\n')
}

export type RespostaDeObra =
  | { tipo: 'obra'; obraId: string; rotulo: string }
  | { tipo: 'nenhuma' }
  | { tipo: 'invalida' }

/** "2", " 2 ", "2)", "opção 2" valem; "12" com 8 opções não. */
export function interpretarRespostaDeObra(texto: unknown, opcoes: OpcaoDeObra[]): RespostaDeObra {
  const m = String(texto ?? '').trim().match(/^(?:op[cç][aã]o\s*)?(\d{1,2})\s*[).]?$/i)
  if (!m) return { tipo: 'invalida' }
  const n = Number(m[1])
  if (n === 0) return { tipo: 'nenhuma' }
  const escolhida = opcoes[n - 1]
  return escolhida ? { tipo: 'obra', obraId: escolhida.id, rotulo: escolhida.rotulo } : { tipo: 'invalida' }
}

/** O que foi gravado em opcoes_obra (jsonb) volta como lista válida, ou vazia. */
export function lerOpcoesGravadas(v: unknown): OpcaoDeObra[] {
  if (!Array.isArray(v)) return []
  return v.filter((o): o is OpcaoDeObra => !!o && typeof o.id === 'string' && typeof o.rotulo === 'string')
}
