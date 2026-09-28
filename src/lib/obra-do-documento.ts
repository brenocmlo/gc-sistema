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
