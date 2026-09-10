/**
 * Camada 5 (dados): roda as queries da aplicação contra gc-dev, autenticado
 * como usuário real, portanto sob RLS.
 *
 * Rodar via `bash scripts/validar.sh dados`. Sozinho:
 *   node --env-file=.env.local scripts/validar-dados.mjs
 *
 * Por que existe: `tsc` e `next build` só comparam a string do select com os
 * types gerados. Coluna que existe no type mas foi renomeada no banco, JOIN
 * aninhado que o PostgREST não resolve, policy de RLS que devolve zero linha
 * pro perfil errado — nada disso aparece no build. Aqui aparece.
 *
 * Cada bloco acrescenta uma entrada em CHECKS com a query REAL da tela (copie
 * do page.tsx, não reescreva por fora, senão valida outra coisa).
 *
 * Uma checagem passa quando: não houve erro do PostgREST, e o `valida`
 * (opcional) não devolveu mensagem. Zero linha NÃO é falha por si — o banco de
 * dev pode estar vazio —, mas é reportado, porque um select que só é exercido
 * com zero linha não provou o JOIN.
 */
import { createClient } from '@supabase/supabase-js'

import { exigirGcDev } from './gc-dev-guard.mjs'

const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const EMAIL = process.env.VALIDACAO_EMAIL
const SENHA = process.env.VALIDACAO_SENHA

if (!URL_SUPABASE || !ANON || !EMAIL || !SENHA) {
  console.error(
    'FALHA: camada dados precisa de NEXT_PUBLIC_SUPABASE_URL,\n' +
      '  NEXT_PUBLIC_SUPABASE_ANON_KEY, VALIDACAO_EMAIL e VALIDACAO_SENHA\n' +
      '  (usuário de gc-dev) em .env.local.',
  )
  process.exit(1)
}

exigirGcDev(URL_SUPABASE, 'a camada de dados')

const hoje = new Date().toISOString().slice(0, 10)

/**
 * @type {{
 *   nome: string,
 *   bloco: string,
 *   query: (sb: import('@supabase/supabase-js').SupabaseClient) => PromiseLike<any>,
 *   valida?: (r: any) => string | null,
 * }[]}
 */
const CHECKS = [
  {
    nome: 'profiles: o usuário da validação tem perfil e empresa',
    bloco: 'base',
    query: (sb) =>
      sb
        .from('profiles')
        .select('id, empresa_id, nome, email, perfil, ativo')
        .eq('email', EMAIL)
        .maybeSingle(),
    // Sem empresa_id a RLS filtra tudo e as outras checagens dariam
    // "0 linhas" por motivo errado.
    valida: (r) =>
      !r.data
        ? 'nenhum profile pra esse e-mail'
        : !r.data.empresa_id
          ? 'profile sem empresa_id'
          : r.data.ativo === false
            ? 'profile inativo'
            : null,
  },
  {
    nome: 'propostas: listagem com JOIN aninhado obra → cliente',
    bloco: '4.3',
    query: (sb) =>
      sb
        .from('propostas')
        .select(
          'id, numero, data_emissao, data_validade, obra_id, status, valor_total, desconto, valor_final, obra:obras(codigo_obra, nome, cliente:clientes(nome))',
          { count: 'exact' },
        )
        .order('data_emissao', { ascending: false, nullsFirst: false })
        .order('numero', { ascending: false })
        .range(0, 19),
    // O JOIN aninhado é o ponto frágil: se o PostgREST devolvesse obra como
    // array (relação lida ao contrário), a tela mostraria "—" em silêncio.
    valida: (r) => {
      const linha = r.data?.[0]
      if (!linha) return null
      if (Array.isArray(linha.obra)) return 'obra veio como array, esperado objeto'
      if (linha.obra && Array.isArray(linha.obra.cliente))
        return 'obra.cliente veio como array, esperado objeto'
      if (linha.valor_final === undefined)
        return 'valor_final ausente (coluna generated)'
      return null
    },
  },
  {
    nome: 'propostas: filtro de vencidas (enviada + validade < hoje)',
    bloco: '4.3',
    query: (sb) =>
      sb
        .from('propostas')
        .select('id, status, data_validade', { count: 'exact' })
        .eq('status', 'enviada')
        .lt('data_validade', hoje)
        .range(0, 19),
    valida: (r) => {
      const errada = (r.data ?? []).find(
        (p) => p.status !== 'enviada' || !(p.data_validade < hoje),
      )
      if (errada) return `linha fora do critério: ${JSON.stringify(errada)}`
      // scripts/seed-propostas-dev.mjs garante pelo menos uma. Zero aqui
      // significa que o seed sumiu, não que o filtro está certo.
      if ((r.data ?? []).length === 0) {
        return 'nenhuma proposta vencida — rode scripts/seed-propostas-dev.mjs'
      }
      return null
    },
  },
  {
    nome: 'propostas: detalhe com obra → cliente e cidade',
    bloco: '4.4',
    query: (sb) =>
      sb
        .from('propostas')
        .select(
          '*, obra:obras(codigo_obra, nome, cidade, cliente:clientes(nome, contato, telefone))',
        )
        .eq('numero', 'SEED-VENCIDA-001')
        .maybeSingle(),
    valida: (r) => {
      if (!r.data) return 'proposta de seed não encontrada'
      if (Array.isArray(r.data.obra)) return 'obra veio como array'
      if (r.data.valor_final !== 45000) {
        return `valor_final=${r.data.valor_final}, esperado 45000 (generated = total - desconto)`
      }
      return null
    },
  },
  {
    nome: 'propostas_financeiro: view do painel financeiro (security_invoker)',
    bloco: '4.4',
    query: (sb) =>
      sb
        .from('propostas_financeiro')
        .select('id, total_nfs, recebido_nfs, total_acordos, recebido_acordos')
        .eq('numero', 'SEED-VENCIDA-001')
        .maybeSingle(),
    valida: (r) =>
      !r.data
        ? 'view não devolveu a proposta de seed'
        : r.data.total_nfs == null
          ? 'total_nfs nulo — o coalesce da view deveria zerar'
          : null,
  },
  {
    nome: 'propostas: coluna historico (jsonb append-only do bloco 4.6)',
    bloco: '4.6',
    query: (sb) =>
      sb
        .from('propostas')
        .select('id, historico')
        .eq('numero', 'SEED-VENCIDA-001')
        .maybeSingle(),
    // A migration 20260905180000 tem CHECK jsonb_typeof = 'array'. Se a coluna
    // não existir, o PostgREST devolve erro e a checagem falha — que é o
    // objetivo: código que grava histórico não pode subir sem a coluna.
    valida: (r) =>
      !r.data
        ? 'proposta de seed não encontrada'
        : !Array.isArray(r.data.historico)
          ? `historico não é lista: ${JSON.stringify(r.data.historico)}`
          : null,
  },
  {
    nome: 'obras: select do filtro de obra (id, codigo_obra, nome, cliente_id)',
    bloco: '4.3',
    query: (sb) =>
      sb
        .from('obras')
        .select('id, codigo_obra, nome, cliente_id', { count: 'exact' })
        .order('codigo_obra', { ascending: false }),
    valida: (r) =>
      r.data?.[0] && !r.data[0].cliente_id
        ? 'obra sem cliente_id (busca por cliente não funcionaria)'
        : null,
  },
  {
    nome: 'orcamentos: coluna historico (migration 013, mesmo formato de propostas)',
    bloco: '4.x (uniformização)',
    query: (sb) =>
      sb
        .from('orcamentos')
        .select('id, historico')
        .order('data_solicitacao', { ascending: false })
        .limit(1)
        .maybeSingle(),
    valida: (r) =>
      !r.data
        ? 'nenhum orçamento em gc-dev'
        : !Array.isArray(r.data.historico)
          ? `historico não é lista: ${JSON.stringify(r.data.historico)}`
          : null,
  },
  {
    nome: 'obras_com_valores: view da listagem (LATERAL calcular_valores_obra)',
    bloco: '4.x (regressão)',
    query: (sb) =>
      sb
        .from('obras_com_valores')
        .select(
          'id, codigo_obra, nome, status, valor_final_calculado, progresso_itens_pct, cliente:clientes(nome)',
          { count: 'exact' },
        )
        .range(0, 19),
    // A view chama calcular_valores_obra por linha via LATERAL: uma obra com
    // contrato vigente ou proposta aprovada basta pra derrubar a listagem
    // inteira. Era esta checagem que faltava quando /obras quebrou em gc-dev
    // com 42702 (ambiguidade de valor_total dentro da função).
  },
  {
    nome: 'calcular_valores_obra: o ramo com contrato/proposta aprovada',
    bloco: '4.x (regressão)',
    query: async (sb) => {
      const obras = await sb.from('obras').select('id, codigo_obra')
      if (obras.error) return obras
      // Roda pra todas: o ramo que quebra é dormente e só aparece na obra
      // que tem contrato ou proposta aprovada.
      const falhas = []
      for (const o of obras.data ?? []) {
        const r = await sb.rpc('calcular_valores_obra', { p_obra_id: o.id })
        if (r.error) falhas.push(`${o.codigo_obra}: ${r.error.code}`)
      }
      return { data: obras.data, count: obras.data?.length ?? 0, error: null, falhas }
    },
    valida: (r) =>
      r.falhas?.length ? `função falhou em ${r.falhas.join(', ')}` : null,
  },
  {
    nome: 'orcamentos: listagem com JOIN de cliente',
    bloco: '4.x (regressão)',
    query: (sb) =>
      sb
        .from('orcamentos')
        .select(
          'id, numero, data_solicitacao, cliente_id, status, valor_estimado, responsavel, cliente:clientes(nome, cidade)',
          { count: 'exact' },
        )
        .order('data_solicitacao', { ascending: false })
        .range(0, 19),
  },
  {
    nome: 'fd: listagem com JOIN de obra',
    bloco: '4.x (regressão)',
    query: (sb) =>
      sb
        .from('fd')
        .select(
          'id, data_lancamento, data_vencimento, data_pagamento, pedido_documento, fornecedor, valor, diferenca_favor, obra:obras(codigo_obra, nome)',
          { count: 'exact' },
        )
        .order('data_lancamento', { ascending: false })
        .range(0, 19),
  },
]

const supabase = createClient(URL_SUPABASE, ANON)
const login = await supabase.auth.signInWithPassword({
  email: EMAIL,
  password: SENHA,
})

if (login.error) {
  console.error(`FALHA: login de ${EMAIL} em gc-dev: ${login.error.message}`)
  process.exit(1)
}

console.log(`  autenticado como ${EMAIL} em ${new global.URL(URL_SUPABASE).hostname}\n`)

let falhas = 0
let vazias = 0

for (const check of CHECKS) {
  const r = await check.query(supabase)

  if (r.error) {
    falhas += 1
    console.log(`  FALHA [${check.bloco}] ${check.nome}`)
    console.log(`         ${r.error.message}`)
    continue
  }

  const problema = check.valida?.(r) ?? null
  if (problema) {
    falhas += 1
    console.log(`  FALHA [${check.bloco}] ${check.nome}`)
    console.log(`         ${problema}`)
    continue
  }

  const n = r.count ?? (Array.isArray(r.data) ? r.data.length : r.data ? 1 : 0)
  if (n === 0) vazias += 1
  console.log(
    `  ok   [${check.bloco}] ${check.nome} — ${n} registro(s)${n === 0 ? ' (query válida, mas não exercitada)' : ''}`,
  )
}

console.log(
  `\n${CHECKS.length - falhas}/${CHECKS.length} checagens ok` +
    (vazias > 0 ? `, ${vazias} sem registro em gc-dev` : ''),
)
process.exit(falhas === 0 ? 0 : 1)
