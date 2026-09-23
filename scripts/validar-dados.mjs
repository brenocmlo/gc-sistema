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
  {
    // Copiada de src/app/(app)/propostas/[id]/page.tsx — a query da aba Itens.
    nome: 'itens: aba Itens da proposta (colunas geradas e ordenação)',
    bloco: '5.2',
    query: (sb) =>
      sb
        .from('itens')
        .select(
          'id, empresa_id, obra_id, proposta_id, contrato_id, numero, tipo, descricao, linha, acabamento, largura, altura, quantidade, unidade, valor_unit, valor_total, area_m2, vidros, localizacao, observacao, foto_url, created_at, updated_at, created_by',
        )
        .order('numero', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .range(0, 19),
    // Duas coisas que só o banco prova: que as colunas GENERATED voltam
    // calculadas (o type diz que existem, não que batem), e que `unidade`
    // respeita o CHECK — se alguém reintroduzir 'ML' por SQL direto, o
    // narrowing de Unidade em types.ts vira mentira e a tela quebra.
    valida: (r) => {
      const linha = r.data?.[0]
      if (!linha) return null

      if (linha.unidade !== null && !['QTD', 'M2'].includes(linha.unidade)) {
        return `unidade "${linha.unidade}" fora do CHECK ('QTD','M2')`
      }

      if (linha.valor_unit !== null && linha.quantidade !== null) {
        const esperado = linha.valor_unit * linha.quantidade
        if (Math.abs((linha.valor_total ?? 0) - esperado) > 0.01) {
          return `valor_total ${linha.valor_total} != valor_unit × quantidade (${esperado})`
        }
      }

      if (
        linha.largura !== null &&
        linha.altura !== null &&
        linha.quantidade !== null
      ) {
        const esperado = linha.largura * linha.altura * linha.quantidade
        if (Math.abs((linha.area_m2 ?? 0) - esperado) > 0.0001) {
          return `area_m2 ${linha.area_m2} != largura × altura × quantidade (${esperado})`
        }
      }

      return null
    },
  },
  {
    // ItemComStatus foi estreitado em src/lib/types.ts no bloco 5.1, mas a view
    // nunca havia sido LIDA — o tipo existia sem prova de que casa com o que o
    // PostgREST devolve. A view é `security_invoker`, então respeita a mesma RLS.
    nome: 'itens_com_status: view de item com execução (security_invoker)',
    bloco: '5.1',
    query: (sb) =>
      sb
        .from('itens_com_status')
        .select(
          'id, numero, descricao, unidade, quantidade, valor_unit, valor_total, area_m2, status_atual, etapa_atual, progresso_pct, progresso_etapas_pct, evidencias_count, status_fabricacao, status_entrega, status_instalacao, status_medicao',
        )
        .order('numero', { ascending: true, nullsFirst: false })
        .range(0, 19),
    // A view faz LEFT JOIN em execucao: item sem execução tem de vir com os
    // coalesce aplicados, não com null. Se algum dia o LEFT virar INNER, a
    // contagem cai em silêncio e só isto acusa.
    valida: (r) => {
      const linha = r.data?.[0]
      if (!linha) return null

      const etapas = [
        'status_fabricacao',
        'status_entrega',
        'status_instalacao',
        'status_medicao',
      ]
      for (const e of etapas) {
        if (linha[e] === null || linha[e] === undefined) {
          return `${e} veio null — o coalesce da view não aplicou`
        }
      }
      if (linha.status_atual === null) return 'status_atual veio null'
      if (linha.etapa_atual === null) return 'etapa_atual veio null'
      if (linha.progresso_pct === null) return 'progresso_pct veio null'
      if (linha.unidade !== null && !['QTD', 'M2'].includes(linha.unidade)) {
        return `unidade "${linha.unidade}" fora do CHECK`
      }
      return null
    },
  },
  {
    // A proposta do seed de itens: prova que a query da aba devolve os 12 e
    // que as colunas geradas vieram calculadas em TODAS as linhas, não só na
    // primeira.
    nome: 'itens: os 12 itens da proposta semeada, com as geradas calculadas',
    bloco: '5.2',
    query: async (sb) => {
      const { data: p } = await sb
        .from('propostas')
        .select('id')
        .eq('numero', 'SEED-ITENS-001')
        .maybeSingle()
      if (!p) return { data: null, error: { message: 'SEED-ITENS-001 ausente — rode bash scripts/aplicar-seed.sh supabase/seed_itens.sql' } }
      return sb
        .from('itens')
        .select('id, numero, quantidade, largura, altura, valor_unit, valor_total, area_m2, unidade')
        .eq('proposta_id', p.id)
        .order('numero', { ascending: true, nullsFirst: false })
    },
    valida: (r) => {
      const linhas = r.data ?? []
      if (linhas.length !== 12) return `esperados 12 itens, vieram ${linhas.length}`

      const semNumero = linhas.filter((l) => l.numero === null).length
      if (semNumero !== 1) return `esperado 1 item sem numero, vieram ${semNumero}`

      for (const l of linhas) {
        if (l.valor_unit !== null && l.quantidade !== null) {
          const esperado = l.valor_unit * l.quantidade
          if (Math.abs((l.valor_total ?? 0) - esperado) > 0.01) {
            return `item ${l.numero}: valor_total ${l.valor_total} != ${esperado}`
          }
        }
        if (l.largura !== null && l.altura !== null && l.quantidade !== null) {
          const esperado = l.largura * l.altura * l.quantidade
          if (Math.abs((l.area_m2 ?? 0) - esperado) > 0.0001) {
            return `item ${l.numero}: area_m2 ${l.area_m2} != ${esperado}`
          }
        }
      }
      return null
    },
  },
  {
    // O invariante que o trigger trg_itens_recalcula_pai (bloco 5.6) mantém:
    // proposta COM itens tem valor_total igual à soma deles. A única exceção
    // aceita é SEED-DIVERGENTE-001, divergente de propósito.
    nome: 'propostas com itens: valor_total igual à soma (trigger do 5.6)',
    bloco: '5.6',
    query: (sb) =>
      sb
        .from('propostas')
        .select('id, numero, valor_total, desconto, itens(valor_total)')
        .neq('numero', 'SEED-DIVERGENTE-001'),
    valida: (r) => {
      const comItens = (r.data ?? []).filter((p) => (p.itens ?? []).length > 0)
      if (comItens.length === 0) return 'nenhuma proposta com itens — o invariante não foi exercitado'
      for (const p of comItens) {
        const soma = p.itens.reduce((a, i) => a + Number(i.valor_total ?? 0), 0)
        // Soma abaixo do desconto é divergência ESPERADA: o trigger não
        // sincroniza porque violaria o CHECK desconto <= valor_total.
        if (soma < Number(p.desconto ?? 0)) continue
        if (Math.abs(Number(p.valor_total) - soma) > 0.005) {
          return `${p.numero}: valor_total ${p.valor_total} != soma dos itens ${soma}`
        }
      }
      return null
    },
  },
  {
    // Contraprova: a checagem acima só vale se souber acusar. A proposta
    // divergente do seed TEM de aparecer divergente — se não aparecer, ou o
    // seed sumiu, ou o trigger passou a reescrever valor digitado.
    nome: 'SEED-DIVERGENTE-001 continua divergente (a checagem acima sabe acusar)',
    bloco: '5.6',
    query: (sb) =>
      sb
        .from('propostas')
        .select('numero, valor_total, itens(valor_total)')
        .eq('numero', 'SEED-DIVERGENTE-001')
        .maybeSingle(),
    valida: (r) => {
      if (!r.data) return 'SEED-DIVERGENTE-001 ausente — rode bash scripts/aplicar-seed.sh supabase/seed_itens.sql'
      const soma = (r.data.itens ?? []).reduce((a, i) => a + Number(i.valor_total ?? 0), 0)
      return Math.abs(Number(r.data.valor_total) - soma) > 0.005
        ? null
        : `valor ${r.data.valor_total} == soma ${soma}: a divergência sumiu`
    },
  },
  {
    // Os 3 contratos que a automação criou em 2026-08 têm itens. O trigger
    // cobre contrato também, e eles já batiam antes da migration.
    nome: 'contratos com itens: valor_total igual à soma',
    bloco: '5.6',
    query: (sb) => sb.from('contratos').select('numero, valor_total, itens(valor_total)'),
    valida: (r) => {
      const comItens = (r.data ?? []).filter((c) => (c.itens ?? []).length > 0)
      if (comItens.length === 0) return null
      for (const c of comItens) {
        const soma = c.itens.reduce((a, i) => a + Number(i.valor_total ?? 0), 0)
        if (Math.abs(Number(c.valor_total) - soma) > 0.005) {
          return `${c.numero}: valor_total ${c.valor_total} != soma dos itens ${soma}`
        }
      }
      return null
    },
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
