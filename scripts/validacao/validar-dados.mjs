/**
 * Camada 5 (dados): roda as queries da aplicação contra gc-dev, autenticado
 * como usuário real, portanto sob RLS.
 *
 * Rodar via `bash scripts/validacao/validar.sh dados`. Sozinho:
 *   node --env-file=.env.local scripts/validacao/validar-dados.mjs
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

import { exigirGcDev } from '../comum/gc-dev-guard.mjs'
import { comNovaTentativa } from '../comum/rede.mjs'
import { sessaoDePerfil } from '../comum/sessao-dev.mjs'

import { rodarMatrizRls } from './matriz-rls.mjs'

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
      // scripts/banco/seed-propostas-dev.mjs garante pelo menos uma. Zero aqui
      // significa que o seed sumiu, não que o filtro está certo.
      if ((r.data ?? []).length === 0) {
        return 'nenhuma proposta vencida — rode scripts/banco/seed-propostas-dev.mjs'
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
      if (!p) return { data: null, error: { message: 'SEED-ITENS-001 ausente — rode bash scripts/banco/aplicar-seed.sh supabase/seed_itens.sql' } }
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
      if (!r.data) return 'SEED-DIVERGENTE-001 ausente — rode bash scripts/banco/aplicar-seed.sh supabase/seed_itens.sql'
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
  {
    // Query de src/app/(app)/logs/page.tsx, com a busca que a camada runtime
    // também usa. O seed (supabase/seed_auditoria.sql) garante as duas linhas.
    nome: 'auditoria_eventos: listagem de /logs com busca (admin)',
    bloco: '13.2',
    query: (sb) =>
      sb
        .from('auditoria_eventos')
        .select(
          'id, em, origem, entidade, registro_id, referencia, acao, resultado, mensagem, autor_id, autor_descricao, detalhe',
          { count: 'exact' },
        )
        .order('em', { ascending: false })
        .order('id', { ascending: false })
        .or('referencia.ilike.%SEED-AUDITORIA%,mensagem.ilike.%SEED-AUDITORIA%,autor_descricao.ilike.%SEED-AUDITORIA%')
        .range(0, 19),
    valida: (r) => {
      const linhas = r.data ?? []
      const erro = linhas.find((e) => e.resultado === 'erro' && e.origem === 'automacao')
      const status = linhas.find((e) => e.acao === 'status')
      if (!erro || !status) {
        return 'eventos do seed ausentes — rode bash scripts/banco/aplicar-seed.sh supabase/seed_auditoria.sql'
      }
      if (status.detalhe?.campos?.status?.para !== 'enviada') {
        return `detalhe do evento de status fora do formato: ${JSON.stringify(status.detalhe)}`
      }
      return null
    },
  },
  {
    nome: 'profiles: autores do filtro de /logs',
    bloco: '13.2',
    query: (sb) => sb.from('profiles').select('id, nome').order('nome'),
    valida: (r) => ((r.data ?? []).length === 0 ? 'nenhum profile visível pro admin' : null),
  },
  {
    // Contraprova da policy: há eventos (a checagem acima viu), e mesmo assim
    // um perfil não-admin tem de ver zero. Devolve a contagem como objeto pra
    // o loop não reportar "não exercitada" — zero aqui é o resultado certo.
    nome: 'auditoria_eventos: comercial não lê nada (RLS só admin)',
    bloco: '13.2',
    query: async () => {
      const { session } = await sessaoDePerfil('comercial')
      const sb = createClient(URL_SUPABASE, ANON, { auth: { persistSession: false } })
      await sb.auth.setSession(session)
      const r = await sb.from('auditoria_eventos').select('id', { count: 'exact' })
      return r.error ? r : { data: { vistas: r.count } }
    },
    valida: (r) => (r.data.vistas === 0 ? null : `comercial viu ${r.data.vistas} evento(s)`),
  },
  {
    // Query de src/app/(app)/contratos/page.tsx, sem filtro.
    nome: 'contratos: listagem com JOIN aninhado obra → cliente',
    bloco: '6.1',
    query: (sb) =>
      sb
        .from('contratos')
        .select(
          'id, numero, data_assinatura, obra_id, status, valor_total, desconto, valor_final, obra:obras(codigo_obra, nome, cliente:clientes(nome))',
          { count: 'exact' },
        )
        .order('data_assinatura', { ascending: false, nullsFirst: false })
        .order('numero', { ascending: false })
        .range(0, 19),
    valida: (r) => {
      const linhas = r.data ?? []
      if (linhas.length === 0) return null
      const l = linhas[0]
      if (Array.isArray(l.obra)) return 'obra veio como array, esperado objeto'
      if (l.obra && Array.isArray(l.obra.cliente)) return 'obra.cliente veio como array, esperado objeto'
      if (l.valor_final === undefined) return 'valor_final ausente (coluna generated de 20260923160000)'
      // Ordem da tela: com data primeiro, mais recente no topo; sem data no fim.
      const datas = linhas.map((c) => c.data_assinatura)
      const primeiraNula = datas.indexOf(null)
      if (primeiraNula >= 0 && datas.slice(primeiraNula).some((d) => d !== null)) {
        return 'contrato sem data de assinatura apareceu antes de um com data'
      }
      const comData = datas.filter((d) => d !== null)
      if (comData.some((d, i) => i > 0 && d > comData[i - 1])) return 'datas fora da ordem decrescente'
      return null
    },
  },
  {
    // O filtro de status da tela: `.eq('status', ...)` com um valor de isContratoStatus.
    nome: 'contratos: filtro de status (suspenso)',
    bloco: '6.1',
    query: (sb) =>
      sb
        .from('contratos')
        .select('id, numero, status', { count: 'exact' })
        .eq('status', 'suspenso')
        .range(0, 19),
    valida: (r) => {
      const errado = (r.data ?? []).find((c) => c.status !== 'suspenso')
      return errado ? `${errado.numero} veio com status ${errado.status}` : null
    },
  },
  {
    // Período sobre data_assinatura: contrato sem data fica fora (gte descarta null).
    nome: 'contratos: filtro de período (últimos 90 dias, por data de assinatura)',
    bloco: '6.1',
    query: (sb) => {
      const d = new Date()
      d.setDate(d.getDate() - 90)
      return sb
        .from('contratos')
        .select('id, numero, data_assinatura', { count: 'exact' })
        .gte('data_assinatura', d.toISOString().slice(0, 10))
        .range(0, 19)
    },
    valida: (r) => {
      const semData = (r.data ?? []).find((c) => c.data_assinatura === null)
      return semData ? `${semData.numero} sem data entrou no período` : null
    },
  },
  {
    // O layout de /contratos libera visualizador: a policy de leitura tem de
    // deixar ele ver as mesmas linhas que o admin.
    nome: 'contratos: visualizador lê a listagem (RLS tenant isolation)',
    bloco: '6.1',
    query: async (sbAdmin) => {
      const admin = await sbAdmin.from('contratos').select('id', { count: 'exact', head: true })
      const { session } = await sessaoDePerfil('visualizador')
      const sb = createClient(URL_SUPABASE, ANON, { auth: { persistSession: false } })
      await sb.auth.setSession(session)
      const r = await sb.from('contratos').select('id', { count: 'exact', head: true })
      return r.error ? r : { data: { admin: admin.count, visualizador: r.count } }
    },
    valida: (r) =>
      r.data.admin === r.data.visualizador
        ? null
        : `admin vê ${r.data.admin}, visualizador vê ${r.data.visualizador}`,
  },
  {
    // Query de src/app/(app)/propostas/[id]/gerar-contrato/page.tsx: os
    // contratos vigentes já gerados de uma proposta. Os 3 TESTE-FASE2-* da
    // automação vêm todos da EB-25-08-0048, então a query volta linha.
    nome: 'contratos: vigentes gerados de uma proposta (aviso de duplicado do 6.2)',
    bloco: '6.2',
    query: async (sb) => {
      const { data: origem } = await sb
        .from('contratos').select('proposta_origem_id').not('proposta_origem_id', 'is', null).limit(1).maybeSingle()
      if (!origem) return { data: [] }
      return sb
        .from('contratos')
        .select('numero, status')
        .eq('proposta_origem_id', origem.proposta_origem_id)
        .neq('status', 'rescindido')
        .order('numero')
    },
    valida: (r) => {
      const rescindido = (r.data ?? []).find((c) => c.status === 'rescindido')
      return rescindido ? `${rescindido.numero} rescindido contou como vigente` : null
    },
  },
  {
    // Query de src/app/(app)/contratos/novo/page.tsx: as obras do select, com
    // o cliente no rótulo. O JOIN tem de vir objeto, senão o rótulo perde o nome.
    nome: 'contratos/novo: obras do select com cliente',
    bloco: '6.3',
    query: (sb) =>
      sb
        .from('obras')
        .select('id, codigo_obra, nome, cliente:clientes(nome)')
        .order('codigo_obra', { ascending: false }),
    valida: (r) => {
      const l = (r.data ?? [])[0]
      if (!l) return null
      return Array.isArray(l.cliente) ? 'cliente veio como array, esperado objeto' : null
    },
  },
  {
    // Query de src/app/(app)/contratos/[id]/page.tsx, sobre um contrato gerado
    // de proposta (os TESTE-FASE2-* da automação): obra → cliente e a proposta
    // de origem pela FK composta contratos_proposta_fk, os dois como objeto.
    nome: 'contratos/[id]: detalhe com obra → cliente e proposta de origem',
    bloco: '6.4',
    query: async (sb) => {
      const { data: alvo } = await sb
        .from('contratos').select('id').not('proposta_origem_id', 'is', null).limit(1).maybeSingle()
      if (!alvo) return { data: [] }
      const r = await sb
        .from('contratos')
        .select(
          '*, obra:obras(codigo_obra, nome, cidade, cliente:clientes(nome, contato, telefone)), proposta_origem:propostas!contratos_proposta_fk(id, numero)',
        )
        .eq('id', alvo.id)
        .maybeSingle()
      return r.error ? r : { data: r.data ? [r.data] : [] }
    },
    valida: (r) => {
      const l = (r.data ?? [])[0]
      if (!l) return null
      if (Array.isArray(l.obra)) return 'obra veio como array, esperado objeto'
      if (l.obra && Array.isArray(l.obra.cliente)) return 'obra.cliente veio como array, esperado objeto'
      if (!l.proposta_origem) return 'proposta_origem nula num contrato com proposta_origem_id'
      if (Array.isArray(l.proposta_origem)) return 'proposta_origem veio como array, esperado objeto'
      if (l.proposta_origem.id !== l.proposta_origem_id) return 'proposta_origem não é a do proposta_origem_id'
      if (!l.proposta_origem.numero) return 'proposta_origem sem número (o link do cabeçalho ficaria vazio)'
      return null
    },
  },
  {
    // Query de itens de src/app/(app)/contratos/[id]/page.tsx: a aba Itens do
    // contrato, na ordem do documento, com número nulo no fim.
    nome: 'contratos/[id]: itens do contrato na ordem do documento',
    bloco: '6.4',
    query: async (sb) => {
      const { data: comItem } = await sb
        .from('itens').select('contrato_id').not('contrato_id', 'is', null).limit(1).maybeSingle()
      if (!comItem) return { data: [] }
      return sb
        .from('itens')
        .select(
          'id, empresa_id, obra_id, proposta_id, contrato_id, numero, tipo, descricao, linha, acabamento, largura, altura, quantidade, unidade, valor_unit, valor_total, area_m2, vidros, localizacao, observacao, foto_url, created_at, updated_at, created_by',
        )
        .eq('contrato_id', comItem.contrato_id)
        .order('numero', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
    },
    valida: (r) => {
      const linhas = r.data ?? []
      if (linhas.some((i) => i.proposta_id !== null)) return 'item de contrato com proposta_id preenchido (XOR)'
      const nums = linhas.map((i) => i.numero)
      const primeiroNulo = nums.indexOf(null)
      if (primeiroNulo >= 0 && nums.slice(primeiroNulo).some((n) => n !== null)) {
        return 'item sem número apareceu antes de um numerado'
      }
      const numerados = nums.filter((n) => n !== null)
      if (numerados.some((n, k) => k > 0 && n < numerados[k - 1])) return 'números fora da ordem crescente'
      return null
    },
  },
  {
    // Bloco 6.5: o que o Detalhes e a aba Histórico leem da rescisão. Espelha
    // o CHECK contratos_rescindido_motivo sobre as linhas reais de gc-dev, e o
    // histórico tem de ser lista (contratos_historico_lista).
    nome: 'contratos: motivo de rescisão só em rescindido, histórico como lista',
    bloco: '6.5',
    query: (sb) => sb.from('contratos').select('numero, status, motivo_rescisao, detalhe_rescisao, historico'),
    valida: (r) => {
      for (const c of r.data ?? []) {
        if (c.status === 'rescindido' && !c.motivo_rescisao) return `${c.numero} rescindido sem motivo`
        if (c.status !== 'rescindido' && c.motivo_rescisao) return `${c.numero} ${c.status} com motivo de rescisão`
        if (!Array.isArray(c.historico)) return `${c.numero}: historico não é lista`
      }
      return null
    },
  },
  {
    // Query de src/app/api/export/contratos/route.ts: dois JOINs (obra →
    // cliente e a proposta de origem) na mesma linha, que o XLSX lê como objeto.
    nome: 'api/export/contratos: JOIN de obra → cliente e proposta de origem',
    bloco: '6.6',
    query: (sb) =>
      sb
        .from('contratos')
        .select(
          'numero, data_assinatura, prazo_execucao, status, valor_total, desconto, valor_final, condicoes_pagamento, motivo_rescisao, detalhe_rescisao, pct_sinal, pct_fd, pct_entrega_material, pct_medicao_instalacao, obra:obras(codigo_obra, nome, cliente:clientes(nome)), proposta_origem:propostas!contratos_proposta_fk(numero)',
        )
        .order('data_assinatura', { ascending: false, nullsFirst: false })
        .order('numero', { ascending: false }),
    valida: (r) => {
      const linhas = r.data ?? []
      if (linhas.some((l) => Array.isArray(l.obra))) return 'obra veio como array, esperado objeto'
      if (linhas.some((l) => Array.isArray(l.proposta_origem))) return 'proposta_origem veio como array, esperado objeto'
      return null
    },
  },
  {
    // Query de src/app/(app)/execucao/page.tsx, na obra do SEED-CT-EXEC: a
    // execução com o item por JOIN !inner, filtrada pela obra do item. A
    // regra da quantidade mudou no 7.4 (várias execuções por item).
    nome: 'execucao: execuções da obra com o item (JOIN !inner filtrado pela obra)',
    bloco: '7.2',
    query: async (sb) => {
      const { data: ct } = await sb.from('contratos').select('obra_id').eq('numero', 'SEED-CT-EXEC').maybeSingle()
      if (!ct) return { data: [] }
      const r = await sb
        .from('execucao')
        .select('*, item:itens!inner(id, numero, tipo, descricao, quantidade, unidade, obra_id)')
        .eq('item.obra_id', ct.obra_id)
        .limit(1000)
      return r.error ? r : { data: r.data, obra: ct.obra_id }
    },
    valida: (r) => {
      const linhas = r.data ?? []
      if (linhas.length === 0) return null
      for (const e of linhas) {
        if (!e.item || Array.isArray(e.item)) return 'item veio nulo ou como array, esperado objeto'
        if (e.item.obra_id !== r.obra) return `execução de outra obra (${e.item.obra_id}) passou pelo filtro`
        // Status GENERATED tem de bater com a regra de statusDaEtapa.
        for (const etapa of ['fab', 'ent', 'inst', 'med']) {
          const q = Number(e[`${etapa}_qtd`])
          const esperado = q === 0 ? 'pendente' : q >= Number(e.quantidade_total) ? 'concluido' : 'andamento'
          if (e[`${etapa}_status`] !== esperado) return `${etapa}_status ${e[`${etapa}_status`]}, esperado ${esperado}`
        }
      }
      // 7.4: com uma execução, ela é o item inteiro (o trigger sincroniza);
      // com várias, cada uma tem a sua parte e a soma cabe no item.
      const porItem = new Map()
      for (const e of linhas) {
        const g = porItem.get(e.item_id) ?? { n: 0, soma: 0, item: Number(e.item.quantidade) }
        g.n += 1
        g.soma += Math.round(Number(e.quantidade_total) * 1000)
        porItem.set(e.item_id, g)
      }
      for (const [itemId, g] of porItem) {
        if (g.n === 1 && g.soma !== Math.round(g.item * 1000)) {
          return `item ${itemId}: a execução única tem ${g.soma / 1000}, o item tem ${g.item}`
        }
        if (g.soma > Math.round(g.item * 1000)) {
          return `item ${itemId}: as ${g.n} execuções somam ${g.soma / 1000}, acima do item (${g.item})`
        }
      }
      return null
    },
  },
  {
    // Query de src/app/(app)/execucao/queries.ts (itensSemExecucao): itens de
    // contrato não rescindido, pelo JOIN !inner com o filtro no status.
    nome: 'execucao: itens de contrato sem execução (ação em lote)',
    bloco: '7.2',
    query: async (sb) => {
      const { data: ct } = await sb.from('contratos').select('obra_id').eq('numero', 'SEED-CT-EXEC').maybeSingle()
      if (!ct) return { data: [] }
      const r = await sb
        .from('itens')
        .select('id, descricao, contrato:contratos!inner(status)')
        .eq('obra_id', ct.obra_id)
        .not('contrato_id', 'is', null)
        .neq('contrato.status', 'rescindido')
      return r
    },
    valida: (r) => {
      const linhas = r.data ?? []
      if (linhas.some((i) => Array.isArray(i.contrato))) return 'contrato veio como array, esperado objeto'
      if (linhas.some((i) => i.contrato?.status === 'rescindido')) return 'item de contrato rescindido passou pelo filtro'
      return null
    },
  },
  {
    // Query de src/app/(app)/configuracoes/contatos/page.tsx: contatos do bot
    // com a obra pelo JOIN. Seed não tem contato Telegram; os 2 de WhatsApp
    // antigos da LC EMPRESA bastam para exercitar o join e a RLS.
    nome: 'contatos_whatsapp: listagem dos contatos do bot com JOIN de obra',
    bloco: 'automação · Fase 7',
    query: (sb) =>
      sb
        .from('contatos_whatsapp')
        .select('id, nome, canal, telegram_chat_id, telefone, obra_id, created_at, obra:obras(codigo_obra, nome)')
        .order('created_at', { ascending: false }),
    valida: (r) => {
      const linhas = r.data ?? []
      if (linhas.some((c) => Array.isArray(c.obra))) return 'obra veio como array, esperado objeto'
      if (linhas.some((c) => !('nome' in c))) return 'coluna nome ausente (migration 20260924100000)'
      return null
    },
  },
  {
    // Query de src/app/(app)/documentos/page.tsx: caixa de entrada com a obra
    // pelo JOIN. gc-dev tem os 29 documentos do fluxo de agosto.
    nome: 'documentos_processamento: listagem da caixa de entrada com JOIN de obra',
    bloco: 'automação · Fase 7',
    query: (sb) =>
      sb
        .from('documentos_processamento')
        .select(
          'id, status, tipo_documento, canal, obra_id, created_at, motivo_revisao, proposta_criada_id, contrato_criado_id, dados_extraidos, conferencia, etapa, obra:obras(codigo_obra, nome)',
          { count: 'exact' },
        )
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(0, 19),
    valida: (r) => {
      const linhas = r.data ?? []
      if (linhas.some((x) => Array.isArray(x.obra))) return 'obra veio como array, esperado objeto'
      if (linhas.some((x) => !['PENDENTE', 'ERRO_VALIDACAO', 'REVISAO_HUMANA', 'APROVADO', 'DESCARTADO'].includes(x.status))) return 'status fora do CHECK'
      return null
    },
  },
  {
    // Query de src/app/(app)/documentos/[id]/page.tsx (painel de revisão): as
    // propostas e contratos da obra do documento, para o "Vincular". E a
    // coluna nova revisado_por (migration 20260925100000) legível sob RLS.
    nome: 'documentos_processamento: colunas de revisão e opções de vínculo da obra',
    bloco: 'automação · Fase 7',
    exigeSeed: 'supabase/seed_automacao.sql',
    query: async (sb) => {
      const doc = await sb.from('documentos_processamento').select('id, obra_id, status, revisado_por, revisado_em').not('obra_id', 'is', null).limit(1).maybeSingle()
      if (doc.error || !doc.data) return doc.error ? doc : { data: [] }
      const [p, c] = await Promise.all([
        sb.from('propostas').select('id, numero').eq('obra_id', doc.data.obra_id).order('numero'),
        sb.from('contratos').select('id, numero').eq('obra_id', doc.data.obra_id).order('numero'),
      ])
      if (p.error) return p
      if (c.error) return c
      return { data: [doc.data, ...(p.data ?? []), ...(c.data ?? [])] }
    },
    valida: (r) => (r.data?.[0] && !('revisado_por' in r.data[0]) ? 'coluna revisado_por ausente' : null),
  },
  {
    // Query de src/app/(app)/documentos/[id]/page.tsx (andamento): a etapa do
    // documento (migration 20260928110000) e os eventos dele, do mais antigo
    // ao mais novo. Pega o documento mais recente que tenha etapa gravada.
    nome: 'automacao_eventos: etapa do documento e andamento em ordem',
    bloco: 'automação · log',
    exigeSeed: 'supabase/seed_automacao.sql',
    query: async (sb) => {
      const doc = await sb
        .from('documentos_processamento')
        .select('id, etapa, etapa_detalhe, etapa_em')
        .not('etapa', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (doc.error || !doc.data) return doc.error ? doc : { data: [] }
      const ev = await sb
        .from('automacao_eventos')
        .select('id, documento_id, etapa, nivel, mensagem, detalhe, origem, criado_em')
        .eq('documento_id', doc.data.id)
        .order('criado_em', { ascending: true })
      if (ev.error) return ev
      return { data: ev.data ?? [] }
    },
    valida: (r) => {
      const linhas = r.data ?? []
      if (linhas.some((e) => !['info', 'aviso', 'erro'].includes(e.nivel))) return 'nível fora do CHECK'
      for (let i = 1; i < linhas.length; i++) {
        if (linhas[i].criado_em < linhas[i - 1].criado_em) return 'eventos fora de ordem'
      }
      return null
    },
  },
  {
    // Query de src/app/(app)/documentos/page.tsx e /documentos/log: os 50
    // eventos mais recentes, de onde sai a faixa "automação parada".
    nome: 'automacao_eventos: eventos recentes para a faixa de automação parada',
    bloco: 'automação · log',
    query: (sb) =>
      sb
        .from('automacao_eventos')
        .select('id, documento_id, etapa, nivel, mensagem, detalhe, origem, criado_em')
        .order('criado_em', { ascending: false })
        .limit(50),
    valida: (r) => ((r.data ?? []).some((e) => !['documento', 'n8n', 'sistema'].includes(e.origem)) ? 'origem fora do CHECK' : null),
  },
  {
    // Query de src/app/(app)/documentos/log/page.tsx: paginada, filtrada por
    // nível, com count.
    nome: 'automacao_eventos: log paginado filtrado por erro',
    bloco: 'automação · log',
    query: (sb) =>
      sb
        .from('automacao_eventos')
        .select('id, documento_id, etapa, nivel, mensagem, detalhe, origem, criado_em', { count: 'exact' })
        .order('criado_em', { ascending: false })
        .order('id', { ascending: false })
        .eq('nivel', 'erro')
        .range(0, 19),
    valida: (r) => ((r.data ?? []).some((e) => e.nivel !== 'erro') ? 'filtro por nível devolveu outro nível' : null),
  },
  {
    // Query de src/app/(app)/contratos/[id]/page.tsx (opção 1.a): as propostas
    // que se declaram aditivo do contrato. Sem embed — propostas e contratos
    // têm duas relações. Pega um contrato que tenha aditivo, se houver.
    nome: 'propostas: aditivos de um contrato (contrato_aditivo_id)',
    bloco: 'automação · aditivo',
    query: async (sb) => {
      const comAditivo = await sb.from('propostas').select('contrato_aditivo_id').not('contrato_aditivo_id', 'is', null).limit(1).maybeSingle()
      if (comAditivo.error) return comAditivo
      const contratoId = comAditivo.data?.contrato_aditivo_id
      if (!contratoId) return { data: [] }
      return sb.from('propostas').select('id, numero, status, valor_total, valor_final').eq('contrato_aditivo_id', contratoId).order('numero')
    },
  },
  {
    // Query de src/app/(app)/propostas/[id]/page.tsx (opção 1.a): contratos da
    // obra da proposta, que podem receber o aditivo.
    nome: 'contratos: os da obra da proposta, para marcar o aditivo',
    bloco: 'automação · aditivo',
    query: async (sb) => {
      const p = await sb.from('propostas').select('id, obra_id').limit(1).maybeSingle()
      if (p.error || !p.data) return p.error ? p : { data: [] }
      return sb.from('contratos').select('id, numero, proposta_origem_id').eq('obra_id', p.data.obra_id).order('numero')
    },
  },
  // ============================================================
  // Sprint 9 — notas fiscais (9.1). Queries copiadas de
  // src/app/(app)/financeiro/notas-fiscais/page.tsx. Precisam do
  // supabase/seed_notas_fiscais.sql.
  // ============================================================
  {
    nome: 'notas_fiscais: listagem com JOIN de obra e os pagamentos (Recebido)',
    bloco: '9.1',
    query: (sb) =>
      sb
        .from('notas_fiscais')
        .select(
          'id, numero, serie, chave_nfe, obra_id, tipo, data_emissao, data_vencimento, valor_total, status, obra:obras(codigo_obra, nome), pagamentos(valor)',
          { count: 'exact' },
        )
        .order('data_emissao', { ascending: false })
        .order('numero', { ascending: false })
        .range(0, 19),
    valida: (r) => {
      const linhas = r.data ?? []
      if (linhas.length === 0) return 'nenhuma NF — rode bash scripts/banco/aplicar-seed.sh supabase/seed_notas_fiscais.sql'
      if (linhas.some((n) => Array.isArray(n.obra))) return 'obra veio como array, esperado objeto'
      if (linhas.some((n) => !Array.isArray(n.pagamentos))) return 'pagamentos não veio como array'
      const paga = linhas.find((n) => n.numero === 'SEED-NF-004')
      if (paga) {
        const recebido = paga.pagamentos.reduce((a, p) => a + Number(p.valor), 0)
        if (paga.status !== 'paga' || recebido !== Number(paga.valor_total)) {
          return `SEED-NF-004: status ${paga.status}, recebido ${recebido} de ${paga.valor_total} (o trigger de pagamento devia ter posto "paga")`
        }
      }
      return null
    },
  },
  {
    // Copiada de src/app/(app)/financeiro/notas-fiscais/[id]/page.tsx (9.3; os campos dos pagamentos, 10.3).
    nome: 'notas_fiscais: detalhe com obra → cliente, contrato, proposta e pagamentos',
    bloco: '9.3',
    query: (sb) =>
      sb
        .from('notas_fiscais')
        .select(
          '*, obra:obras(codigo_obra, nome, cliente:clientes(nome)), contrato:contratos(id, numero), proposta:propostas(id, numero), pagamentos(id, origem, data_pagamento, valor, forma, observacao, anexo, created_at)',
        )
        .eq('numero', 'SEED-NF-001')
        .maybeSingle(),
    valida: (r) => {
      const nf = r.data
      if (!nf) return 'SEED-NF-001 não veio — rode o seed_notas_fiscais.sql'
      if (Array.isArray(nf.obra) || Array.isArray(nf.contrato) || Array.isArray(nf.proposta)) return 'obra, contrato ou proposta veio como array'
      if (nf.contrato?.numero !== 'SEED-CT-001') return `contrato do vínculo: ${JSON.stringify(nf.contrato)}`
      if (nf.proposta !== null) return 'proposta devia vir nula (XOR)'
      if (!nf.obra?.cliente) return 'obra sem cliente no JOIN aninhado'
      // 10.3: a aba Pagamentos lê as baixas pelo mesmo JOIN.
      if (!Array.isArray(nf.pagamentos)) return 'pagamentos não veio como array'
      return null
    },
  },
  {
    nome: 'notas_fiscais: filtro "vencida" (emitida ou paga parcialmente, vencimento < hoje)',
    bloco: '9.1',
    query: (sb) =>
      sb
        .from('notas_fiscais')
        .select('id, numero, status, data_vencimento', { count: 'exact' })
        .in('status', ['emitida', 'paga_parcialmente'])
        .lt('data_vencimento', hoje)
        .range(0, 19),
    valida: (r) => {
      const errada = (r.data ?? []).find((n) => !['emitida', 'paga_parcialmente'].includes(n.status) || !(n.data_vencimento < hoje))
      if (errada) return `linha fora do critério: ${JSON.stringify(errada)}`
      if (!(r.data ?? []).some((n) => n.numero === 'SEED-NF-002')) return 'a SEED-NF-002 (vencida) não veio'
      return null
    },
  },
  {
    nome: 'notas_fiscais: filtro "emitida" tira as vencidas (dois .or na mesma query)',
    bloco: '9.1',
    query: (sb) =>
      sb
        .from('notas_fiscais')
        .select('id, numero, status, data_vencimento', { count: 'exact' })
        .or('numero.ilike.%SEED-NF%,chave_nfe.ilike.%SEED-NF%')
        .in('status', ['emitida'])
        .or(`data_vencimento.is.null,data_vencimento.gte.${hoje}`)
        .range(0, 19),
    // A busca e o "não vencida" são dois .or() na mesma query, como na page:
    // o PostgREST tem de combinar os dois com E.
    valida: (r) => {
      const nums = (r.data ?? []).map((n) => n.numero).sort()
      if (nums.includes('SEED-NF-002')) return 'a SEED-NF-002, vencida, veio no filtro "emitida"'
      if (JSON.stringify(nums) !== JSON.stringify(['SEED-NF-001', 'SEED-NF-006'])) return `esperado SEED-NF-001 e 006, veio ${JSON.stringify(nums)}`
      return null
    },
  },
  {
    // Copiada de src/app/(app)/financeiro/pagamentos/page.tsx (10.1; anexo e o status da NF, 10.4).
    nome: 'pagamentos: listagem com JOIN de obra, NF e parcela → acordo (coluna Documento)',
    bloco: '10.1',
    exigeSeed: 'supabase/seed_pagamentos.sql',
    query: (sb) =>
      sb
        .from('pagamentos')
        .select(
          'id, data_pagamento, obra_id, origem, forma, valor, observacao, nota_id, parcela_acordo_id, anexo, obra:obras(codigo_obra, nome), nota:notas_fiscais(numero, serie, status), parcela:acordo_parcelas(numero_parcela, acordo:acordos_pagamento(descricao))',
          { count: 'exact' },
        )
        .order('data_pagamento', { ascending: false })
        .order('created_at', { ascending: false })
        .range(0, 19),
    valida: (r) => {
      const linhas = r.data ?? []
      if (linhas.some((p) => Array.isArray(p.obra) || Array.isArray(p.nota) || Array.isArray(p.parcela))) {
        return 'obra, nota ou parcela veio como array, esperado objeto'
      }
      // pagamento_vinculo_consistente, visto do JOIN: cada origem com o seu documento.
      for (const p of linhas) {
        if (p.origem === 'nf' && (!p.nota || p.parcela)) return `pagamento ${p.id} de NF sem a NF no JOIN (ou com parcela)`
        if (p.origem === 'nf' && !p.nota.status) return `pagamento ${p.id}: a NF veio sem status (o estorno depende dele)`
        if (!('anexo' in p)) return 'coluna anexo ausente (a migration 004 renomeou comprovante_url)'
        if (p.origem === 'acordo' && (!p.parcela?.acordo || p.nota)) return `pagamento ${p.id} de acordo sem parcela → acordo no JOIN`
        if (p.origem === 'avulso' && (p.nota || p.parcela)) return `pagamento ${p.id} avulso com vínculo`
      }
      const origens = new Set(linhas.map((p) => p.origem))
      if (!['nf', 'acordo', 'avulso'].every((o) => origens.has(o))) return `faltam origens no seed: veio ${[...origens].join(', ')}`
      return null
    },
  },
  {
    // Copiada de src/app/(app)/financeiro/pagamentos/opcoes.ts (10.2): o select
    // de NF do formulário, sem as canceladas, com os pagamentos para o saldo.
    nome: 'notas_fiscais: opções do pagamento, sem canceladas, com pagamentos para o saldo',
    bloco: '10.2',
    exigeSeed: 'supabase/seed_notas_fiscais.sql',
    query: (sb) =>
      sb
        .from('notas_fiscais')
        .select('id, numero, serie, obra_id, status, valor_total, pagamentos(valor)')
        .neq('status', 'cancelada')
        .order('data_emissao', { ascending: false }),
    valida: (r) => {
      const linhas = r.data ?? []
      if (linhas.some((n) => n.status === 'cancelada')) return 'NF cancelada nas opções de pagamento'
      if (linhas.some((n) => !Array.isArray(n.pagamentos))) return 'pagamentos não veio como array'
      const nf3 = linhas.find((n) => n.numero === 'SEED-NF-003')
      if (nf3) {
        const pago = nf3.pagamentos.reduce((a, p) => a + Math.round(Number(p.valor) * 100), 0)
        if (Math.round(Number(nf3.valor_total) * 100) - pago !== 300000) return `saldo da SEED-NF-003 ${(Math.round(Number(nf3.valor_total) * 100) - pago) / 100}, esperado 3000`
      }
      return null
    },
  },
  {
    // Copiada de src/app/(app)/financeiro/pagamentos/opcoes.ts (10.2): parcelas
    // não canceladas, com os pagamentos (JOIN pagamentos_parcela_fk) para o saldo.
    nome: 'acordo_parcelas: opções do pagamento com os pagamentos da parcela (saldo)',
    bloco: '10.2',
    exigeSeed: 'supabase/seed_pagamentos.sql',
    query: (sb) =>
      sb
        .from('acordo_parcelas')
        .select('id, acordo_id, numero_parcela, data_vencimento, valor_previsto, status, pagamentos(valor)')
        .neq('status', 'cancelada')
        .order('numero_parcela'),
    valida: (r) => {
      const linhas = r.data ?? []
      if (linhas.some((p) => !Array.isArray(p.pagamentos))) return 'pagamentos não veio como array'
      const paga = linhas.find((p) => p.numero_parcela === 1 && p.pagamentos.length > 0)
      if (!paga) return 'a parcela 1 do SEED-AC-001 devia ter o pagamento de 3.000'
      if (paga.status !== 'paga') return `parcela 1 com status ${paga.status}; o trigger devia ter posto "paga"`
      return null
    },
  },
  {
    // Copiada de src/app/(app)/financeiro/pagamentos/opcoes.ts (10.2).
    nome: 'acordos_pagamento: só os abertos, para o select de acordo',
    bloco: '10.2',
    exigeSeed: 'supabase/seed_pagamentos.sql',
    query: (sb) => sb.from('acordos_pagamento').select('id, descricao, obra_id').eq('status', 'aberto').order('data_abertura', { ascending: false }),
    valida: (r) => ((r.data ?? []).some((a) => a.descricao === 'SEED-AC-001 Sinal outubro') ? null : 'SEED-AC-001 não veio entre os acordos abertos'),
  },
  {
    // Copiada de src/app/(app)/financeiro/acordos/page.tsx (11.1).
    nome: 'acordos_pagamento: listagem com JOIN de obra e as parcelas (valor total, nº e atrasadas)',
    bloco: '11.1',
    exigeSeed: 'supabase/seed_acordos.sql',
    query: (sb) =>
      sb
        .from('acordos_pagamento')
        .select(
          'id, descricao, obra_id, motivo, periodo_ref, data_abertura, data_encerramento, status, obra:obras(codigo_obra, nome), parcelas:acordo_parcelas(valor_previsto, status, data_vencimento)',
          { count: 'exact' },
        )
        .order('data_abertura', { ascending: false })
        .order('created_at', { ascending: false })
        .range(0, 19),
    valida: (r) => {
      const linhas = r.data ?? []
      if (linhas.some((a) => Array.isArray(a.obra))) return 'obra veio como array, esperado objeto'
      if (linhas.some((a) => !Array.isArray(a.parcelas))) return 'parcelas não veio como array'
      const status = new Set(linhas.map((a) => a.status))
      for (const s of ['aberto', 'quitado', 'cancelado']) if (!status.has(s)) return `nenhum acordo ${s} no seed`
      if (linhas.some((a) => a.parcelas.some((p) => ['parcial', 'atrasada'].includes(p.status)))) return "parcela com status antigo ('parcial'/'atrasada') no banco"
      const quitado = linhas.find((a) => a.descricao === 'SEED-AC-002 Adiantamento de vidros')
      if (quitado && (!quitado.data_encerramento || quitado.parcelas.some((p) => p.status !== 'paga'))) return 'SEED-AC-002 quitado sem data de encerramento ou com parcela não paga'
      return null
    },
  },
  {
    // Copiada de src/app/(app)/financeiro/acordos/[id]/page.tsx (11.3; a NF da conversão, 11.4).
    nome: 'acordos_pagamento: detalhe com obra → cliente, vínculo e parcelas → pagamentos',
    bloco: '11.3',
    exigeSeed: 'supabase/seed_acordos.sql',
    query: (sb) =>
      sb
        .from('acordos_pagamento')
        .select(
          '*, obra:obras(codigo_obra, nome, cliente:clientes(nome)), contrato:contratos(id, numero), proposta:propostas(id, numero), nf:notas_fiscais!acordo_nf_convertida_fk(id, numero, serie), parcelas:acordo_parcelas(id, numero_parcela, data_vencimento, valor_previsto, status, observacao, pagamentos(valor))',
        )
        .eq('descricao', 'SEED-AC-002 Adiantamento de vidros')
        .maybeSingle(),
    valida: (r) => {
      const a = r.data
      if (!a) return 'SEED-AC-002 não veio — rode o seed_acordos.sql'
      if (Array.isArray(a.obra) || Array.isArray(a.contrato) || Array.isArray(a.proposta)) return 'obra, contrato ou proposta veio como array'
      if (!a.obra?.cliente) return 'obra sem cliente no JOIN aninhado'
      if (a.contrato?.numero !== 'SEED-CT-EXEC-45' || a.proposta !== null) return `vínculo: ${JSON.stringify([a.contrato, a.proposta])}`
      if (!Array.isArray(a.parcelas) || a.parcelas.some((p) => !Array.isArray(p.pagamentos))) return 'parcelas ou pagamentos não vieram como array'
      const recebido = a.parcelas.reduce((acc, p) => acc + p.pagamentos.reduce((x, pg) => x + Math.round(Number(pg.valor) * 100), 0), 0)
      if (recebido !== 650000) return `recebido do quitado ${recebido / 100}, esperado 6500`
      return null
    },
  },
  {
    // 11.4, regra 7: o acordo convertido (SEED-AC-005) aponta para a NF de
    // saldo, e o pagamento dele fica arquivado em receitas_obra — fora do
    // total_recebido. A view é security_invoker: o RLS do admin vale.
    nome: 'receitas_obra: o pagamento do acordo convertido fica arquivado, fora do recebido',
    bloco: '11.4',
    exigeSeed: 'supabase/seed_acordos.sql',
    query: async (sb) => {
      const ac = await sb
        .from('acordos_pagamento')
        .select('obra_id, status, nf:notas_fiscais!acordo_nf_convertida_fk(numero, status, valor_total)')
        .eq('descricao', 'SEED-AC-005 Sinal convertido')
        .maybeSingle()
      if (ac.error || !ac.data) return ac.error ? ac : { data: [] }
      const v = await sb
        .from('receitas_obra')
        .select('obra_id, total_acordos_convertidos_arquivado, total_recebido, total_a_receber, saldo_pendente')
        .eq('obra_id', ac.data.obra_id)
        .maybeSingle()
      if (v.error) return v
      return { data: [{ ...ac.data, receitas: v.data }] }
    },
    valida: (r) => {
      const a = r.data?.[0]
      if (!a) return 'SEED-AC-005 não veio'
      if (a.status !== 'convertido_nf' || a.nf?.numero !== 'SEED-CONV-001') return `acordo ${a.status}, NF ${JSON.stringify(a.nf)}`
      if (Number(a.receitas?.total_acordos_convertidos_arquivado) < 1500) return `arquivado ${a.receitas?.total_acordos_convertidos_arquivado}, esperado ao menos 1.500 (o pagamento do SEED-AC-005)`
      return null
    },
  },
  {
    // Aba Financeiro da obra (12.1): as queries da page (obras/[id]/page.tsx,
    // carregarFinanceiro), montadas pelos helpers, conferidas número a número
    // contra a soma manual das tabelas base. Nas duas obras dos seeds: a do
    // SEED-CT-EXEC (6 NFs, uma vencida e uma cancelada) e a do SEED-CT-EXEC-45
    // (a parcela atrasada do SEED-AC-004 e o arquivado do SEED-AC-005).
    nome: 'aba Financeiro da obra: blocos, listas e linha do tempo batem com a soma manual das tabelas',
    bloco: '12.1',
    exigeSeed: 'supabase/seed_acordos.sql',
    query: async (sb) => {
      const fo = await import('../../src/lib/financeiro-obra.ts')
      const { hojeISO } = await import('../../src/lib/execucao.ts')
      const hoje = hojeISO()
      const cts = await sb.from('contratos').select('numero, obra_id').in('numero', ['SEED-CT-EXEC', 'SEED-CT-EXEC-45'])
      if (cts.error) return cts
      const saida = []
      for (const ct of cts.data ?? []) {
        const obraId = ct.obra_id
        const [valores, receitas, fin, nfs, acordos, pagamentos] = await Promise.all([
          sb.from('obras_com_valores').select('valor_final_calculado').eq('id', obraId).maybeSingle(),
          sb.from('receitas_obra').select('total_recebido, saldo_pendente, total_acordos_convertidos_arquivado').eq('obra_id', obraId).maybeSingle(),
          sb.from('obras_financeiro').select('total_faturado, total_fd_aceito').eq('obra_id', obraId).maybeSingle(),
          sb.from('notas_fiscais').select('id, numero, serie, tipo, status, data_emissao, data_vencimento, valor_total, pagamentos(valor)').eq('obra_id', obraId).order('data_emissao', { ascending: false }).limit(1000),
          sb.from('acordos_pagamento').select('id, descricao, status, parcelas:acordo_parcelas(id, numero_parcela, data_vencimento, valor_previsto, status, pagamentos(valor))').eq('obra_id', obraId).eq('status', 'aberto').limit(1000),
          sb.from('pagamentos').select('id, data_pagamento, origem, forma, valor, nota:notas_fiscais(numero, serie, status), parcela:acordo_parcelas(numero_parcela, acordo:acordos_pagamento(descricao, status))').eq('obra_id', obraId).order('data_pagamento', { ascending: false }).limit(1000),
        ])
        const erro = [valores, receitas, fin, nfs, acordos, pagamentos].find((r) => r.error)
        if (erro) return erro
        const linhasNf = (nfs.data ?? []).map((n) => fo.linhaDaNf(n, hoje))
        const parcelas = fo.parcelasEmAberto(acordos.data ?? [], hoje)
        const blocos = fo.blocosFinanceiros(valores.data?.valor_final_calculado ?? null, receitas.data, fin.data, fo.atrasadoDaObra(linhasNf, parcelas))
        const tempo = fo.linhaDoTempo(pagamentos.data ?? [])

        // A soma manual, das tabelas base (não das views).
        const [nfBase, pgBase, parcBase, fdBase] = await Promise.all([
          sb.from('notas_fiscais').select('id, status, valor_total, data_vencimento').eq('obra_id', obraId),
          sb.from('pagamentos').select('valor, nota_id, parcela_acordo_id, parcela:acordo_parcelas(acordo:acordos_pagamento(status))').eq('obra_id', obraId),
          sb.from('acordo_parcelas').select('id, status, valor_previsto, data_vencimento, acordo:acordos_pagamento!inner(obra_id, status)').eq('acordo.obra_id', obraId),
          sb.from('fd').select('valor_descontar').eq('obra_id', obraId),
        ])
        const erroBase = [nfBase, pgBase, parcBase, fdBase].find((r) => r.error)
        if (erroBase) return erroBase
        const c = (v) => Math.round(Number(v ?? 0) * 100)
        const pagoDe = (campo, id) => (pgBase.data ?? []).filter((p) => p[campo] === id).reduce((a, p) => a + c(p.valor), 0)
        const nfsValidas = (nfBase.data ?? []).filter((n) => n.status !== 'cancelada')
        const parcValidas = (parcBase.data ?? []).filter((p) => !['cancelado', 'convertido_nf'].includes(p.acordo.status) && p.status !== 'cancelada')
        const recebido = (pgBase.data ?? []).filter((p) => p.parcela?.acordo?.status !== 'convertido_nf').reduce((a, p) => a + c(p.valor), 0)
        const manual = {
          faturado: nfsValidas.reduce((a, n) => a + c(n.valor_total), 0),
          recebido,
          aReceber: nfsValidas.reduce((a, n) => a + c(n.valor_total), 0) + parcValidas.reduce((a, p) => a + c(p.valor_previsto), 0) - recebido,
          atrasado:
            (nfBase.data ?? []).filter((n) => ['emitida', 'paga_parcialmente'].includes(n.status) && n.data_vencimento && n.data_vencimento < hoje)
              .reduce((a, n) => a + Math.max(0, c(n.valor_total) - pagoDe('nota_id', n.id)), 0) +
            (parcBase.data ?? []).filter((p) => p.acordo.status === 'aberto' && ['pendente', 'paga_parcialmente'].includes(p.status) && p.data_vencimento < hoje)
              .reduce((a, p) => a + Math.max(0, c(p.valor_previsto) - pagoDe('parcela_acordo_id', p.id)), 0),
          fdDescontado: (fdBase.data ?? []).reduce((a, f) => a + c(f.valor_descontar), 0),
          qtdNfs: (nfBase.data ?? []).length,
          qtdParcelasAbertas: (parcBase.data ?? []).filter((p) => p.acordo.status === 'aberto' && ['pendente', 'paga_parcialmente'].includes(p.status)).length,
        }
        saida.push({ numero: ct.numero, blocos, manual, qtdNfs: linhasNf.length, qtdParcelas: parcelas.length, acumulado: tempo[0]?.acumulado ?? 0 })
      }
      return { data: saida }
    },
    valida: (r) => {
      if ((r.data ?? []).length !== 2) return `esperava as 2 obras dos seeds, vieram ${(r.data ?? []).length}`
      const c = (v) => Math.round(Number(v ?? 0) * 100)
      for (const o of r.data) {
        for (const k of ['faturado', 'recebido', 'aReceber', 'atrasado', 'fdDescontado']) {
          if (c(o.blocos[k]) !== o.manual[k]) return `${o.numero}: ${k} da aba ${o.blocos[k]} ≠ soma manual ${o.manual[k] / 100}`
        }
        if (o.qtdNfs !== o.manual.qtdNfs) return `${o.numero}: ${o.qtdNfs} NFs na lista, ${o.manual.qtdNfs} na tabela`
        if (o.qtdParcelas !== o.manual.qtdParcelasAbertas) return `${o.numero}: ${o.qtdParcelas} parcelas em aberto na lista, ${o.manual.qtdParcelasAbertas} na tabela`
        if (c(o.acumulado) !== c(o.blocos.recebido)) return `${o.numero}: o acumulado da linha do tempo (${o.acumulado}) não é o recebido (${o.blocos.recebido})`
      }
      const ac = r.data.find((o) => o.numero === 'SEED-CT-EXEC-45')
      if (ac && c(ac.blocos.atrasado) < 120000) return `SEED-CT-EXEC-45: atrasado ${ac.blocos.atrasado}, esperado ao menos 1.200 (a parcela 1 do SEED-AC-004)`
      return null
    },
  },
  {
    // Visão geral do financeiro (12.2): as queries de carregar.ts, montadas
    // pelos helpers. Sem período, o faturado e o recebido somados por obra têm
    // de ser os das views (obras_financeiro.total_faturado e
    // receitas_obra.total_recebido) em toda obra; e o card "A receber" é a
    // soma do saldo pendente. As faixas são conferidas contra a soma manual
    // dos saldos das NFs e parcelas em aberto.
    nome: 'visão geral do financeiro: faturado e recebido por obra (todo o período) = views; cards e faixas = soma manual',
    bloco: '12.2',
    exigeSeed: 'supabase/seed_acordos.sql',
    query: async (sb) => {
      const fe = await import('../../src/lib/financeiro-empresa.ts')
      const { hojeISO } = await import('../../src/lib/execucao.ts')
      const hoje = hojeISO()
      const todas = async (pagina) => {
        const linhas = []
        for (let de = 0; ; de += 1000) {
          const { data, error } = await pagina(de, de + 999)
          if (error) throw new Error(error.message)
          linhas.push(...(data ?? []))
          if ((data ?? []).length < 1000) return linhas
        }
      }
      try {
        const [receitas, nfs, parcelas, pagamentos, fin] = await Promise.all([
          todas((de, ate) => sb.from('receitas_obra').select('obra_id, codigo_obra, obra_nome, total_recebido, total_a_receber, saldo_pendente').order('codigo_obra').range(de, ate)),
          todas((de, ate) => sb.from('notas_fiscais').select('id, obra_id, numero, serie, status, data_emissao, data_vencimento, valor_total, pagamentos(valor)').order('id').range(de, ate)),
          todas((de, ate) => sb.from('acordo_parcelas').select('id, numero_parcela, data_vencimento, valor_previsto, status, pagamentos(valor), acordo:acordos_pagamento!inner(id, descricao, obra_id, status)').eq('acordo.status', 'aberto').order('id').range(de, ate)),
          todas((de, ate) => sb.from('pagamentos').select('obra_id, data_pagamento, valor, origem, parcela:acordo_parcelas(acordo:acordos_pagamento(status))').order('id').range(de, ate)),
          todas((de, ate) => sb.from('obras_financeiro').select('obra_id, total_faturado').order('obra_id').range(de, ate)),
        ])
        const faturado = fe.faturadoPorObra(nfs, null)
        const recebido = fe.recebidoPorObra(pagamentos, null)
        const contas = fe.contasAReceber(nfs, parcelas, hoje)
        const faixas = fe.resumoPorFaixa(contas)
        const cards = fe.cardsDaEmpresa(receitas, fe.somaDoMapa(fe.recebidoPorObra(pagamentos, fe.inicioDoPeriodo('mes', hoje))), faixas)
        return { data: [{ hoje, receitas, fin, faturado: Object.fromEntries(faturado), recebido: Object.fromEntries(recebido), faixas, cards, nfs, parcelas, pagamentos }] }
      } catch (e) {
        return { error: { message: e.message } }
      }
    },
    valida: (r) => {
      const d = r.data?.[0]
      if (!d) return 'nada veio'
      const c = (v) => Math.round(Number(v ?? 0) * 100)
      const finPorObra = Object.fromEntries(d.fin.map((f) => [f.obra_id, f.total_faturado]))
      for (const o of d.receitas) {
        if (c(d.faturado[o.obra_id]) !== c(finPorObra[o.obra_id])) return `${o.codigo_obra}: faturado somado ${d.faturado[o.obra_id] ?? 0} ≠ obras_financeiro ${finPorObra[o.obra_id]}`
        if (c(d.recebido[o.obra_id]) !== c(o.total_recebido)) return `${o.codigo_obra}: recebido somado ${d.recebido[o.obra_id] ?? 0} ≠ receitas_obra ${o.total_recebido}`
      }
      if (c(d.cards.aReceber) !== d.receitas.reduce((a, o) => a + c(o.saldo_pendente), 0)) return `card A receber ${d.cards.aReceber} ≠ soma do saldo pendente`
      // Soma manual das faixas: o saldo de cada documento em aberto, sem os helpers.
      const pago = (lista) => (lista ?? []).reduce((a, p) => a + c(p.valor), 0)
      const docs = [
        ...d.nfs.filter((n) => ['emitida', 'paga_parcialmente'].includes(n.status)).map((n) => ({ v: n.data_vencimento, s: Math.max(0, c(n.valor_total) - pago(n.pagamentos)) })),
        ...d.parcelas.filter((p) => ['pendente', 'paga_parcialmente'].includes(p.status)).map((p) => ({ v: p.data_vencimento, s: Math.max(0, c(p.valor_previsto) - pago(p.pagamentos)) })),
      ].filter((x) => x.s > 0)
      const ate = (dias) => { const t = new Date(`${d.hoje}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + dias); return t.toISOString().slice(0, 10) }
      const vencidas = docs.filter((x) => x.v && x.v < d.hoje).reduce((a, x) => a + x.s, 0)
      const ate30 = docs.filter((x) => x.v && x.v >= d.hoje && x.v <= ate(30)).reduce((a, x) => a + x.s, 0)
      if (c(d.cards.atrasado) !== vencidas) return `card Atrasado ${d.cards.atrasado} ≠ soma manual das vencidas ${vencidas / 100}`
      if (c(d.cards.previsto30) !== ate30) return `card Previsto 30 dias ${d.cards.previsto30} ≠ soma manual ${ate30 / 100}`
      const totalFaixas = Object.values(d.faixas).reduce((a, f) => a + c(f.total), 0)
      if (totalFaixas !== docs.reduce((a, x) => a + x.s, 0)) return `as faixas somam ${totalFaixas / 100}, os documentos em aberto ${docs.reduce((a, x) => a + x.s, 0) / 100}`
      // O recebido do mês, também à mão.
      const inicioMes = `${d.hoje.slice(0, 7)}-01`
      const mes = d.pagamentos.filter((p) => p.data_pagamento >= inicioMes && !(p.origem === 'acordo' && p.parcela?.acordo?.status === 'convertido_nf')).reduce((a, p) => a + c(p.valor), 0)
      if (c(d.cards.recebidoNoPeriodo) !== mes) return `card Recebido no mês ${d.cards.recebidoNoPeriodo} ≠ soma manual ${mes / 100}`
      if (d.faixas.vencidas.quantidade < 1) return 'sem documento vencido: o seed tem a parcela 1 do SEED-AC-004 e a SEED-NF-002 vencidas'
      return null
    },
  },
  {
    // Dashboard (12.3): as contagens de _dashboard/carregar.ts, com as mesmas
    // queries (count head), conferidas contra a contagem manual das linhas.
    // A etapa de cada execução é recalculada aqui à mão (a primeira com
    // quantidade abaixo do total), sem passar pelo etapaAtual.
    nome: 'dashboard: funil, operação e pendências = contagem manual das tabelas',
    bloco: '12.3',
    exigeSeed: 'supabase/seed_acordos.sql',
    query: async (sb) => {
      const db = await import('../../src/lib/dashboard.ts')
      const { hojeISO } = await import('../../src/lib/execucao.ts')
      const hoje = hojeISO()
      const so = { count: 'exact', head: true }
      const contar = async (q) => { const { count, error } = await q; if (error) throw new Error(error.message); return count ?? 0 }
      const todas = async (pagina) => {
        const linhas = []
        for (let de = 0; ; de += 1000) {
          const { data, error } = await pagina(de, de + 999)
          if (error) throw new Error(error.message)
          linhas.push(...(data ?? []))
          if ((data ?? []).length < 1000) return linhas
        }
      }
      try {
        const [emAberto, enviadas, aprovadas, rejeitadas, obrasAtivas, execucoes, orcPendentes, propVencidas, emRevisao, aConferir, fdsVencidos] = await Promise.all([
          contar(sb.from('orcamentos').select('id', so).in('status', db.ORCAMENTO_EM_ABERTO)),
          contar(sb.from('propostas').select('id', so).eq('status', 'enviada')),
          contar(sb.from('propostas').select('id', so).eq('status', 'aprovada')),
          contar(sb.from('propostas').select('id', so).eq('status', 'rejeitada')),
          contar(sb.from('obras').select('id', so).eq('status', 'ativa')),
          todas((de, ate) => sb.from('execucao').select('quantidade_total, fab_qtd, ent_qtd, inst_qtd, med_qtd, fab_previsao_fim, ent_previsao_fim, inst_previsao_fim, med_previsao_fim, item:itens!inner(obra:obras!inner(id, codigo_obra, nome, status))').eq('item.obra.status', 'ativa').order('id').range(de, ate)),
          contar(sb.from('orcamentos').select('id', so).eq('status', 'pendente')),
          contar(sb.from('propostas').select('id', so).eq('status', 'enviada').lt('data_validade', hoje)),
          contar(sb.from('documentos_processamento').select('id', so).eq('status', 'REVISAO_HUMANA')),
          contar(sb.from('documentos_processamento').select('id', so).eq('status', 'APROVADO').eq('conferencia', 'pendente')),
          contar(sb.from('fd').select('id', so).is('data_pagamento', null).lt('data_vencimento', hoje)),
        ])
        // A contagem manual: as linhas inteiras, filtradas aqui.
        const [orcs, props, obras, execBase, docs, fds] = await Promise.all([
          todas((de, ate) => sb.from('orcamentos').select('status').order('id').range(de, ate)),
          todas((de, ate) => sb.from('propostas').select('status, data_validade').order('id').range(de, ate)),
          todas((de, ate) => sb.from('obras').select('id, status').order('id').range(de, ate)),
          todas((de, ate) => sb.from('execucao').select('quantidade_total, fab_qtd, ent_qtd, inst_qtd, med_qtd, fab_previsao_fim, ent_previsao_fim, inst_previsao_fim, med_previsao_fim, item:itens(obra_id)').order('id').range(de, ate)),
          todas((de, ate) => sb.from('documentos_processamento').select('status, conferencia').order('id').range(de, ate)),
          todas((de, ate) => sb.from('fd').select('data_pagamento, data_vencimento').order('id').range(de, ate)),
        ])
        return {
          data: [{
            hoje,
            app: { emAberto, enviadas, aprovadas, rejeitadas, obrasAtivas, execucoes: execucoes.length, porEtapa: db.execucoesPorEtapa(execucoes), atrasos: db.atrasosPorObra(execucoes, hoje), orcPendentes, propVencidas, emRevisao, aConferir, fdsVencidos },
            orcs, props, obras, execBase, docs, fds,
          }],
        }
      } catch (e) {
        return { error: { message: e.message } }
      }
    },
    valida: (r) => {
      const d = r.data?.[0]
      if (!d) return 'nada veio'
      const a = d.app
      const conta = (lista, f) => lista.filter(f).length
      const manual = {
        emAberto: conta(d.orcs, (o) => ['pendente', 'analise', 'enviado'].includes(o.status)),
        enviadas: conta(d.props, (p) => p.status === 'enviada'),
        aprovadas: conta(d.props, (p) => p.status === 'aprovada'),
        rejeitadas: conta(d.props, (p) => p.status === 'rejeitada'),
        obrasAtivas: conta(d.obras, (o) => o.status === 'ativa'),
        orcPendentes: conta(d.orcs, (o) => o.status === 'pendente'),
        propVencidas: conta(d.props, (p) => p.status === 'enviada' && p.data_validade && p.data_validade < d.hoje),
        emRevisao: conta(d.docs, (x) => x.status === 'REVISAO_HUMANA'),
        aConferir: conta(d.docs, (x) => x.status === 'APROVADO' && x.conferencia === 'pendente'),
        fdsVencidos: conta(d.fds, (f) => !f.data_pagamento && f.data_vencimento && f.data_vencimento < d.hoje),
      }
      for (const [k, v] of Object.entries(manual)) if (a[k] !== v) return `${k}: dashboard ${a[k]}, contagem manual ${v}`
      const ativas = new Set(d.obras.filter((o) => o.status === 'ativa').map((o) => o.id))
      const execAtivas = d.execBase.filter((e) => ativas.has(e.item?.obra_id))
      if (a.execucoes !== execAtivas.length) return `execuções das obras ativas: dashboard ${a.execucoes}, manual ${execAtivas.length}`
      const m = (v) => Math.round(Number(v) * 1000)
      const etapas = ['fab', 'ent', 'inst', 'med']
      const porEtapa = { fab: 0, ent: 0, inst: 0, med: 0 }
      let atrasadas = 0
      for (const e of execAtivas) {
        const atual = etapas.find((x) => m(e[`${x}_qtd`]) < m(e.quantidade_total) || m(e.quantidade_total) === 0)
        if (atual) porEtapa[atual] += 1
        if (etapas.some((x) => e[`${x}_previsao_fim`] && e[`${x}_previsao_fim`] < d.hoje && (m(e[`${x}_qtd`]) < m(e.quantidade_total) || m(e.quantidade_total) === 0))) atrasadas += 1
      }
      for (const x of etapas) if (a.porEtapa[x] !== porEtapa[x]) return `em ${x}: dashboard ${a.porEtapa[x]}, manual ${porEtapa[x]}`
      const somaAtrasos = a.atrasos.reduce((s, o) => s + o.execucoes, 0)
      if (somaAtrasos !== atrasadas) return `execuções atrasadas: dashboard ${somaAtrasos}, manual ${atrasadas}`
      if (a.obrasAtivas < 1 || a.execucoes < 1) return 'não exercitada: sem obra ativa com execução em gc-dev'
      if (a.aprovadas + a.rejeitadas < 1) return 'não exercitada: sem proposta decidida, a taxa de conversão fica "—"'
      return null
    },
  },
  {
    // Gráficos do dashboard (12.4): os dados que vão para os gráficos, com as
    // queries de _dashboard/carregar.ts e os helpers, contra a conta manual
    // das linhas (contagem, soma em centavos por mês, média das etapas).
    nome: 'dashboard: funil, receita de 12 meses, progresso das obras e motivos = conta manual',
    bloco: '12.4',
    exigeSeed: 'supabase/seed_acordos.sql',
    query: async (sb) => {
      const db = await import('../../src/lib/dashboard.ts')
      const { hojeISO } = await import('../../src/lib/execucao.ts')
      const hoje = hojeISO()
      const so = { count: 'exact', head: true }
      const contar = async (q) => { const { count, error } = await q; if (error) throw new Error(error.message); return count ?? 0 }
      const todas = async (pagina) => {
        const linhas = []
        for (let de = 0; ; de += 1000) {
          const { data, error } = await pagina(de, de + 999)
          if (error) throw new Error(error.message)
          linhas.push(...(data ?? []))
          if ((data ?? []).length < 1000) return linhas
        }
      }
      try {
        const inicio12 = `${db.ultimos12Meses(hoje)[0]}-01`
        const [nOrc, nProp, nCt, orcRej, propRej, pg, nf, ex] = await Promise.all([
          contar(sb.from('orcamentos').select('id', so)),
          contar(sb.from('propostas').select('id', so).neq('status', 'rascunho')),
          contar(sb.from('contratos').select('id', so)),
          todas((de, ate) => sb.from('orcamentos').select('motivo_rejeicao').eq('status', 'rejeitado').order('id').range(de, ate)),
          todas((de, ate) => sb.from('propostas').select('motivo_rejeicao').eq('status', 'rejeitada').order('id').range(de, ate)),
          todas((de, ate) => sb.from('pagamentos').select('data_pagamento, valor, origem, parcela:acordo_parcelas(acordo:acordos_pagamento(status))').gte('data_pagamento', inicio12).order('id').range(de, ate)),
          todas((de, ate) => sb.from('notas_fiscais').select('data_emissao, status, valor_total').gte('data_emissao', inicio12).order('id').range(de, ate)),
          todas((de, ate) => sb.from('execucao').select('quantidade_total, fab_qtd, ent_qtd, inst_qtd, med_qtd, fab_previsao_fim, ent_previsao_fim, inst_previsao_fim, med_previsao_fim, item:itens!inner(obra:obras!inner(id, codigo_obra, nome, status))').eq('item.obra.status', 'ativa').order('id').range(de, ate)),
        ])
        const [orcs, props, cts, pgBase, nfBase, exBase, obras] = await Promise.all([
          todas((de, ate) => sb.from('orcamentos').select('status, motivo_rejeicao').order('id').range(de, ate)),
          todas((de, ate) => sb.from('propostas').select('status, motivo_rejeicao').order('id').range(de, ate)),
          todas((de, ate) => sb.from('contratos').select('id').order('id').range(de, ate)),
          todas((de, ate) => sb.from('pagamentos').select('data_pagamento, valor, origem, parcela_acordo_id').order('id').range(de, ate)),
          todas((de, ate) => sb.from('notas_fiscais').select('data_emissao, status, valor_total').order('id').range(de, ate)),
          todas((de, ate) => sb.from('execucao').select('quantidade_total, fab_qtd, ent_qtd, inst_qtd, med_qtd, item:itens(obra_id)').order('id').range(de, ate)),
          todas((de, ate) => sb.from('obras').select('id, status').order('id').range(de, ate)),
        ])
        const parcelas = await todas((de, ate) => sb.from('acordo_parcelas').select('id, acordo:acordos_pagamento(status)').order('id').range(de, ate))
        return {
          data: [{
            hoje,
            app: {
              funil: db.funilComercial({ orcamentos: nOrc, propostas: nProp, contratos: nCt }),
              receita: db.receitaPorMes(pg, nf, hoje),
              progresso: db.progressoDasObras(ex),
              motivos: db.motivosDeRejeicao(orcRej, propRej),
            },
            orcs, props, cts, pgBase, nfBase, exBase, obras, parcelas,
          }],
        }
      } catch (e) {
        return { error: { message: e.message } }
      }
    },
    valida: (r) => {
      const d = r.data?.[0]
      if (!d) return 'nada veio'
      const a = d.app
      const c = (v) => Math.round(Number(v ?? 0) * 100)
      // Funil
      const funil = [d.orcs.length, d.props.filter((p) => p.status !== 'rascunho').length, d.cts.length]
      if (JSON.stringify(a.funil.map((e) => e.quantidade)) !== JSON.stringify(funil)) return `funil ${JSON.stringify(a.funil.map((e) => e.quantidade))}, manual ${JSON.stringify(funil)}`
      // Receita: os 12 meses à mão, a partir das tabelas base
      const convertida = new Set(d.parcelas.filter((p) => p.acordo?.status === 'convertido_nf').map((p) => p.id))
      for (const m of a.receita) {
        const rec = d.pgBase.filter((p) => p.data_pagamento.slice(0, 7) === m.mes && !(p.origem === 'acordo' && convertida.has(p.parcela_acordo_id))).reduce((s, p) => s + c(p.valor), 0)
        const fat = d.nfBase.filter((n) => n.data_emissao.slice(0, 7) === m.mes && n.status !== 'cancelada').reduce((s, n) => s + c(n.valor_total), 0)
        if (c(m.recebido) !== rec) return `recebido de ${m.mes}: gráfico ${m.recebido}, manual ${rec / 100}`
        if (c(m.faturado) !== fat) return `faturado de ${m.mes}: gráfico ${m.faturado}, manual ${fat / 100}`
      }
      if (a.receita.length !== 12 || a.receita.at(-1).mes !== d.hoje.slice(0, 7)) return 'a receita não termina no mês corrente com 12 meses'
      // Progresso: média das quatro etapas agregadas, por obra ativa
      const ativas = new Set(d.obras.filter((o) => o.status === 'ativa').map((o) => o.id))
      const porObra = new Map()
      for (const e of d.exBase) { if (!ativas.has(e.item?.obra_id)) continue; const l = porObra.get(e.item.obra_id) ?? []; l.push(e); porObra.set(e.item.obra_id, l) }
      if (a.progresso.length !== porObra.size) return `obras no gráfico de progresso: ${a.progresso.length}, manual ${porObra.size}`
      for (const o of a.progresso) {
        const l = porObra.get(o.obraId)
        const tot = l.reduce((s, e) => s + Number(e.quantidade_total), 0)
        const pct = (k) => tot > 0 ? Math.min(l.reduce((s, e) => s + Number(e[`${k}_qtd`]), 0) / tot, 1) * 100 : 0
        const manual = ['fab', 'ent', 'inst', 'med'].reduce((s, k) => s + pct(k), 0) / 4
        if (Math.abs(manual - o.progresso) > 0.02) return `progresso de ${o.codigo}: gráfico ${o.progresso}, manual ${manual.toFixed(2)}`
      }
      // Motivos
      const conta = (lista, st) => lista.filter((x) => x.status === st).reduce((m, x) => { const k = x.motivo_rejeicao ?? 'sem_motivo'; m[k] = (m[k] ?? 0) + 1; return m }, {})
      const mo = conta(d.orcs, 'rejeitado'), mp = conta(d.props, 'rejeitada')
      for (const x of a.motivos) if ((mo[x.motivo] ?? 0) !== x.orcamentos || (mp[x.motivo] ?? 0) !== x.propostas) return `motivo ${x.motivo}: gráfico ${x.orcamentos}/${x.propostas}, manual ${mo[x.motivo] ?? 0}/${mp[x.motivo] ?? 0}`
      if (Object.keys({ ...mo, ...mp }).length !== a.motivos.length) return 'quantidade de motivos diferente da manual'
      if (a.progresso.length === 0) return 'não exercitada: sem obra ativa com execução'
      if (a.motivos.length === 0) return 'não exercitada: sem rejeição registrada'
      if (!a.receita.some((m) => m.recebido > 0 || m.faturado > 0)) return 'não exercitada: sem receita nos últimos 12 meses'
      return null
    },
  },
  {
    // Conferência da sprint 12 (12.5): cada KPI que a aplicação mostra
    // (cards e pendências do dashboard, visão geral, aba Financeiro de cada
    // obra, dados dos gráficos) contra supabase/conferencia_kpis.sql, que
    // calcula o mesmo número em SQL escrito à mão, só com tabelas base. O
    // lado da aplicação usa as queries e os helpers das páginas, inclusive as
    // views onde a página usa view — é aí que um erro de view apareceria.
    // O SQL roda por `supabase db query --linked`, travado em gc-dev.
    nome: 'conferência: cada KPI da sprint 12 = SQL escrito à mão nas tabelas base',
    bloco: '12.5',
    exigeSeed: 'supabase/seed_conferencia_12_5.sql',
    query: async (sb) => {
      const { readFileSync, writeFileSync, mkdtempSync } = await import('node:fs')
      const { execFileSync } = await import('node:child_process')
      const { tmpdir } = await import('node:os')
      const { join } = await import('node:path')
      const db = await import('../../src/lib/dashboard.ts')
      const fe = await import('../../src/lib/financeiro-empresa.ts')
      const fo = await import('../../src/lib/financeiro-obra.ts')
      const { hojeISO } = await import('../../src/lib/execucao.ts')
      const hoje = hojeISO()
      try {
        // Trava: o projeto linkado da CLI tem de ser gc-dev.
        const ligado = readFileSync('supabase/.temp/project-ref', 'utf8').trim()
        if (ligado !== 'gzbmhgnpoehormnidmgg') throw new Error(`a CLI está ligada a ${ligado}, não a gc-dev`)
        const { data: { user } } = await sb.auth.getUser()
        const { data: perfil, error: ep } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
        if (ep) throw new Error(ep.message)
        const dir = mkdtempSync(join(tmpdir(), 'kpis-'))
        const arq = join(dir, 'kpis.sql')
        writeFileSync(arq, readFileSync('supabase/conferencia_kpis.sql', 'utf8').replaceAll('{{EMPRESA}}', perfil.empresa_id))
        const saida = execFileSync('npx', ['--yes', 'supabase', 'db', 'query', '--linked', '--output-format', 'json', '--file', arq], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 120000 })
        const sqlRows = JSON.parse(saida.slice(saida.indexOf('{'))).rows
        const sql = Object.fromEntries(sqlRows.map((r) => [r.kpi, Number(r.valor)]))

        // O lado da aplicação.
        const so = { count: 'exact', head: true }
        const contar = async (q) => { const { count, error } = await q; if (error) throw new Error(error.message); return count ?? 0 }
        const todas = async (pagina) => {
          const linhas = []
          for (let de = 0; ; de += 1000) {
            const { data, error } = await pagina(de, de + 999)
            if (error) throw new Error(error.message)
            linhas.push(...(data ?? []))
            if ((data ?? []).length < 1000) return linhas
          }
        }
        const app = {}
        app.orcamentos_em_aberto = await contar(sb.from('orcamentos').select('id', so).in('status', db.ORCAMENTO_EM_ABERTO))
        app.propostas_enviadas = await contar(sb.from('propostas').select('id', so).eq('status', 'enviada'))
        app.propostas_aprovadas = await contar(sb.from('propostas').select('id', so).eq('status', 'aprovada'))
        app.propostas_rejeitadas = await contar(sb.from('propostas').select('id', so).eq('status', 'rejeitada'))
        const funil = db.funilComercial({
          orcamentos: await contar(sb.from('orcamentos').select('id', so)),
          propostas: await contar(sb.from('propostas').select('id', so).neq('status', 'rascunho')),
          contratos: await contar(sb.from('contratos').select('id', so)),
        })
        ;[app.funil_orcamentos, app.funil_propostas, app.funil_contratos] = funil.map((e) => e.quantidade)
        const motivos = db.motivosDeRejeicao(
          await todas((de, ate) => sb.from('orcamentos').select('motivo_rejeicao').eq('status', 'rejeitado').order('id').range(de, ate)),
          await todas((de, ate) => sb.from('propostas').select('motivo_rejeicao').eq('status', 'rejeitada').order('id').range(de, ate)),
        )
        for (const m of motivos) {
          if (m.orcamentos) app[`motivo_orcamento:${m.motivo}`] = m.orcamentos
          if (m.propostas) app[`motivo_proposta:${m.motivo}`] = m.propostas
        }
        app.pend_orcamentos_pendentes = await contar(sb.from('orcamentos').select('id', so).eq('status', 'pendente'))
        app.pend_propostas_vencidas = await contar(sb.from('propostas').select('id', so).eq('status', 'enviada').lt('data_validade', hoje))
        app.pend_documentos_revisao = await contar(sb.from('documentos_processamento').select('id', so).eq('status', 'REVISAO_HUMANA'))
        app.pend_documentos_conferir = await contar(sb.from('documentos_processamento').select('id', so).eq('status', 'APROVADO').eq('conferencia', 'pendente'))
        app.pend_fds_vencidos = await contar(sb.from('fd').select('id', so).is('data_pagamento', null).lt('data_vencimento', hoje))
        app.obras_ativas = await contar(sb.from('obras').select('id', so).eq('status', 'ativa'))
        const ex = await todas((de, ate) => sb.from('execucao').select('quantidade_total, fab_qtd, ent_qtd, inst_qtd, med_qtd, fab_previsao_fim, ent_previsao_fim, inst_previsao_fim, med_previsao_fim, item:itens!inner(obra:obras!inner(id, codigo_obra, nome, status))').eq('item.obra.status', 'ativa').order('id').range(de, ate))
        app.execucoes_ativas = ex.length
        for (const [k, v] of Object.entries(db.execucoesPorEtapa(ex))) app[`etapa:${k}`] = v
        app.execucoes_atrasadas = db.atrasosPorObra(ex, hoje).reduce((s, o) => s + o.execucoes, 0)
        for (const o of db.progressoDasObras(ex)) app[`progresso:${o.codigo}`] = o.progresso
        // Visão geral (as queries de financeiro/visao-geral/carregar.ts)
        const [receitas, nfs, parcelas, pagamentos] = await Promise.all([
          todas((de, ate) => sb.from('receitas_obra').select('obra_id, codigo_obra, obra_nome, total_recebido, total_a_receber, saldo_pendente').order('codigo_obra').range(de, ate)),
          todas((de, ate) => sb.from('notas_fiscais').select('id, obra_id, numero, serie, status, data_emissao, data_vencimento, valor_total, pagamentos(valor)').order('id').range(de, ate)),
          todas((de, ate) => sb.from('acordo_parcelas').select('id, numero_parcela, data_vencimento, valor_previsto, status, pagamentos(valor), acordo:acordos_pagamento!inner(id, descricao, obra_id, status)').eq('acordo.status', 'aberto').order('id').range(de, ate)),
          todas((de, ate) => sb.from('pagamentos').select('obra_id, data_pagamento, valor, origem, parcela:acordo_parcelas(acordo:acordos_pagamento(status))').order('id').range(de, ate)),
        ])
        const faixas = fe.resumoPorFaixa(fe.contasAReceber(nfs, parcelas, hoje))
        const cards = fe.cardsDaEmpresa(receitas, fe.somaDoMapa(fe.recebidoPorObra(pagamentos, fe.inicioDoPeriodo('mes', hoje))), faixas)
        app.a_receber = cards.aReceber
        app.recebido_mes = cards.recebidoNoPeriodo
        app.atrasado = cards.atrasado
        app.previsto_30 = cards.previsto30
        app.pend_documentos_vencidos = faixas.vencidas.quantidade
        const inicio12 = `${db.ultimos12Meses(hoje)[0]}-01`
        for (const m of db.receitaPorMes(pagamentos.filter((p) => p.data_pagamento >= inicio12), nfs.filter((n) => n.data_emissao >= inicio12), hoje)) {
          app[`recebido:${m.mes}`] = m.recebido
          app[`faturado:${m.mes}`] = m.faturado
        }
        // Aba Financeiro de cada obra (as queries de obras/[id]/page.tsx)
        const obras = await todas((de, ate) => sb.from('obras').select('id, codigo_obra').order('id').range(de, ate))
        for (const o of obras) {
          const [valores, rec, fin, nfsO, acordos] = await Promise.all([
            sb.from('obras_com_valores').select('valor_final_calculado').eq('id', o.id).maybeSingle(),
            sb.from('receitas_obra').select('total_recebido, saldo_pendente, total_acordos_convertidos_arquivado').eq('obra_id', o.id).maybeSingle(),
            sb.from('obras_financeiro').select('total_faturado, total_fd_aceito').eq('obra_id', o.id).maybeSingle(),
            sb.from('notas_fiscais').select('id, numero, serie, tipo, status, data_emissao, data_vencimento, valor_total, pagamentos(valor)').eq('obra_id', o.id).limit(1000),
            sb.from('acordos_pagamento').select('id, descricao, status, parcelas:acordo_parcelas(id, numero_parcela, data_vencimento, valor_previsto, status, pagamentos(valor))').eq('obra_id', o.id).eq('status', 'aberto').limit(1000),
          ])
          const erro = [valores, rec, fin, nfsO, acordos].find((r) => r.error)
          if (erro) throw new Error(erro.error.message)
          const linhasNf = (nfsO.data ?? []).map((n) => fo.linhaDaNf(n, hoje))
          const bl = fo.blocosFinanceiros(valores.data?.valor_final_calculado ?? null, rec.data, fin.data, fo.atrasadoDaObra(linhasNf, fo.parcelasEmAberto(acordos.data ?? [], hoje)))
          app[`obra_faturado:${o.codigo_obra}`] = bl.faturado
          app[`obra_recebido:${o.codigo_obra}`] = bl.recebido
          app[`obra_a_receber:${o.codigo_obra}`] = bl.aReceber
          app[`obra_atrasado:${o.codigo_obra}`] = bl.atrasado
          app[`obra_fd_descontado:${o.codigo_obra}`] = bl.fdDescontado
          app[`obra_arquivado:${o.codigo_obra}`] = Number(rec.data?.total_acordos_convertidos_arquivado ?? 0)
        }
        // A obra do 12.5: FD, acordo convertido e NF cancelada ao mesmo tempo
        const { data: ct45 } = await sb.from('contratos').select('obra_id, obra:obras(codigo_obra)').eq('numero', 'SEED-CT-EXEC-45').single()
        const [nFd, nConv, nCanc] = await Promise.all([
          contar(sb.from('fd').select('id', so).eq('obra_id', ct45.obra_id)),
          contar(sb.from('acordos_pagamento').select('id', so).eq('obra_id', ct45.obra_id).eq('status', 'convertido_nf')),
          contar(sb.from('notas_fiscais').select('id', so).eq('obra_id', ct45.obra_id).eq('status', 'cancelada')),
        ])
        return { data: [{ sql, app, obra3: { codigo: ct45.obra.codigo_obra, nFd, nConv, nCanc } }] }
      } catch (e) {
        return { error: { message: e.message } }
      }
    },
    valida: (r) => {
      const d = r.data?.[0]
      if (!d) return 'nada veio'
      const { sql, app } = d
      const c = (v) => Math.round(Number(v) * 100)
      const divergencias = []
      for (const k of new Set([...Object.keys(sql), ...Object.keys(app)])) {
        const tolerancia = k.startsWith('progresso:') ? 2 : 0 // o app arredonda cada etapa antes da média
        if (!(k in sql)) { if (c(app[k]) !== 0) divergencias.push(`${k}: app ${app[k]}, SQL sem linha`); continue }
        if (!(k in app)) { if (c(sql[k]) !== 0) divergencias.push(`${k}: SQL ${sql[k]}, app sem número`); continue }
        if (Math.abs(c(app[k]) - c(sql[k])) > tolerancia) divergencias.push(`${k}: app ${app[k]}, SQL ${sql[k]}`)
      }
      if (divergencias.length) return `${divergencias.length} divergência(s): ${divergencias.slice(0, 6).join('; ')}`
      const o = d.obra3
      if (!(app.pend_documentos_conferir > 0)) return 'não exercitada: nenhum documento a conferir (o SEED-DOC-CONF do seed_conferencia_12_5.sql)'
      if (!(app.pend_fds_vencidos > 0)) return 'não exercitada: nenhum FD vencido (o SEED-FD-VENC do seed_conferencia_12_5.sql)'
      if (!(o.nFd > 0 && o.nConv > 0 && o.nCanc > 0)) return `a obra ${o.codigo} não tem as três situações (FD ${o.nFd}, convertido ${o.nConv}, NF cancelada ${o.nCanc}): aplique o seed`
      if (c(app[`obra_faturado:${o.codigo}`]) !== 150000 || c(app[`obra_a_receber:${o.codigo}`]) !== 390000 || c(app[`obra_recebido:${o.codigo}`]) !== 650000 || c(app[`obra_atrasado:${o.codigo}`]) !== 120000)
        return `a obra ${o.codigo} mudou com a NF cancelada: faturado ${app[`obra_faturado:${o.codigo}`]}, a receber ${app[`obra_a_receber:${o.codigo}`]}, recebido ${app[`obra_recebido:${o.codigo}`]}, atrasado ${app[`obra_atrasado:${o.codigo}`]}`
      return null
    },
  },
  {
    // Gestão de usuários (13.1): a query de configuracoes/usuarios/page.tsx,
    // sob RLS, contra a contagem manual pela service role; e as funções das
    // policies exigindo o usuário ativo (migration 20261005120000).
    nome: 'usuários: a lista da página = perfis da empresa; nenhum de outra empresa',
    bloco: '13.1',
    query: async (sb) => {
      const { createClient } = await import('@supabase/supabase-js')
      const { data: { user } } = await sb.auth.getUser()
      const { data: eu, error: e1 } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
      if (e1) return { error: e1 }
      const pagina = await sb.from('profiles').select('id, nome, email, telefone, perfil, ativo, created_at').eq('empresa_id', eu.empresa_id).order('nome')
      if (pagina.error) return pagina
      const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
      const todos = await svc.from('profiles').select('id, empresa_id')
      if (todos.error) return todos
      const semFiltro = await sb.from('profiles').select('id, empresa_id')
      return { data: [{ pagina: pagina.data, todos: todos.data, semFiltro: semFiltro.data ?? [], empresa: eu.empresa_id }] }
    },
    valida: (r) => {
      const d = r.data?.[0]
      if (!d) return 'nada veio'
      const daEmpresa = d.todos.filter((p) => p.empresa_id === d.empresa).length
      if (d.pagina.length !== daEmpresa) return `a página lista ${d.pagina.length}, a empresa tem ${daEmpresa}`
      if (d.semFiltro.some((p) => p.empresa_id !== d.empresa)) return 'o RLS deixou o admin ver perfil de outra empresa'
      if (d.pagina.length < 6) return 'não exercitada: a empresa tem menos de 6 usuários (os perfis de teste)'
      return null
    },
  },
  {
    // Aba Histórico da NF (13.2): a query de financeiro/notas-fiscais/[id]/page.tsx,
    // como financeiro, numa NF que tem eventos (o admin acha qual). A policy da
    // migration 20261006100000 abre os eventos da NF para quem vê a NF; o
    // comercial, que não entra em /financeiro, continua sem ler nenhum.
    nome: 'auditoria_eventos: aba Histórico da NF como financeiro; comercial não lê',
    bloco: '13.2',
    query: async (sb) => {
      const alvo = await sb
        .from('auditoria_eventos')
        .select('registro_id')
        .eq('entidade', 'notas_fiscais')
        .not('registro_id', 'is', null)
        .order('em', { ascending: false })
        .limit(50)
      if (alvo.error) return alvo
      const ids = Array.from(new Set((alvo.data ?? []).map((e) => e.registro_id)))
      const nfs = ids.length > 0 ? await sb.from('notas_fiscais').select('id, numero').in('id', ids).limit(1) : { data: [] }
      if (nfs.error) return nfs
      const nf = nfs.data?.[0]
      if (!nf) return { data: [] }
      const comoPerfil = async (perfil) => {
        const { session } = await sessaoDePerfil(perfil)
        const c = createClient(URL_SUPABASE, ANON, { auth: { persistSession: false } })
        await c.auth.setSession(session)
        return c
      }
      const fin = await comoPerfil('financeiro')
      const pagina = await fin
        .from('auditoria_eventos')
        .select('id, em, origem, entidade, registro_id, referencia, acao, resultado, mensagem, autor_id, autor_descricao, detalhe')
        .eq('entidade', 'notas_fiscais')
        .eq('registro_id', nf.id)
        .order('em', { ascending: false })
        .order('id', { ascending: false })
      if (pagina.error) return pagina
      const outras = await fin.from('auditoria_eventos').select('id', { count: 'exact', head: true }).neq('entidade', 'notas_fiscais')
      const com = await comoPerfil('comercial')
      const comercial = await com.from('auditoria_eventos').select('id', { count: 'exact', head: true }).eq('registro_id', nf.id)
      return { data: [{ nf: nf.numero, eventos: pagina.data, outras: outras.count, comercial: comercial.count }] }
    },
    valida: (r) => {
      const d = r.data?.[0]
      if (!d) return 'não exercitada: nenhuma NF com evento de auditoria em gc-dev'
      if (d.eventos.length === 0) return `o financeiro não vê o histórico da NF ${d.nf}`
      if (d.eventos.some((e) => e.entidade !== 'notas_fiscais')) return 'veio evento de outra entidade'
      if (d.outras !== 0) return `o financeiro leu ${d.outras} evento(s) de outras entidades`
      if (d.comercial !== 0) return `o comercial leu ${d.comercial} evento(s) da NF`
      return null
    },
  },
  {
    // Matriz de RLS do 13.3 (matriz-rls.json): cada perfil × tabela × operação
    // pela sessão do usuário de teste, com a escrita desfeita, e cada perfil ×
    // bucket × operação pela API de Storage. Uma divergência é uma policy
    // frouxa ou apertada demais em relação à regra documentada.
    nome: 'matriz de RLS: perfil × tabela × CRUD e perfil × bucket batem com matriz-rls.json',
    bloco: '13.3',
    query: async () => {
      try {
        const r = await rodarMatrizRls()
        console.log(`         matriz: ${r.tabelas.conferidas} células de tabela, ${r.buckets.conferidas} de bucket`)
        return { data: [r] }
      } catch (e) {
        return { error: { message: e.message } }
      }
    },
    valida: (r) => {
      const { tabelas, buckets, esperadas } = r.data[0]
      if (tabelas.semAmostra.length > 0) return `não exercitada: sem linha de amostra em ${tabelas.semAmostra.join(', ')}`
      const div = [...tabelas.divergencias, ...buckets.divergencias]
      if (div.length > 0) return `${div.length} divergência(s):\n           ${div.join('\n           ')}`
      if (tabelas.conferidas !== esperadas.tabelas || buckets.conferidas !== esperadas.buckets) {
        return `células conferidas ${tabelas.conferidas}/${buckets.conferidas}, esperado ${esperadas.tabelas}/${esperadas.buckets}`
      }
      return null
    },
  },
  {
    // 13.3, bypass pela API sem sessão: com só a chave pública, nenhuma tabela
    // devolve linha e as funções SECURITY DEFINER que gravavam status por id
    // (revogadas na migration 20261007100000) recusam a chamada.
    nome: 'anon: nenhuma tabela legível e as RPCs de status por id recusadas',
    bloco: '13.3',
    query: async () => {
      const { readFileSync } = await import('node:fs')
      const tabelas = Object.keys(JSON.parse(readFileSync(new URL('./matriz-rls.json', import.meta.url), 'utf8')).tabelas)
      const anon = createClient(URL_SUPABASE, ANON, { auth: { persistSession: false } })
      const lidas = []
      for (const t of tabelas) {
        const r = await anon.from(t).select('*', { count: 'exact', head: true })
        if (!r.error && (r.count ?? 0) > 0) lidas.push(`${t}=${r.count}`)
      }
      const zero = '00000000-0000-0000-0000-000000000000'
      const nf = await anon.rpc('atualizar_status_nf_by_id', { p_nota_id: zero })
      const parcela = await anon.rpc('atualizar_status_parcela_by_id', { p_parcela_id: zero })
      return { data: [{ tabelas: tabelas.length, lidas, rpcNf: nf.error?.code ?? 'executou', rpcParcela: parcela.error?.code ?? 'executou' }] }
    },
    valida: (r) => {
      const d = r.data[0]
      if (d.lidas.length > 0) return `anon leu: ${d.lidas.join(', ')}`
      if (d.rpcNf !== '42501' || d.rpcParcela !== '42501') return `RPC por id sem recusa de permissão: nf ${d.rpcNf}, parcela ${d.rpcParcela}`
      return null
    },
  },
  {
    // O totalizador da page: a mesma condição da lista, só com o valor.
    nome: 'pagamentos: totalizador do filtrado (origem avulso) em centavos',
    bloco: '10.1',
    exigeSeed: 'supabase/seed_pagamentos.sql',
    query: (sb) => sb.from('pagamentos').select('valor').eq('origem', 'avulso'),
    valida: (r) => {
      const centavos = (r.data ?? []).reduce((a, p) => a + Math.round(Number(p.valor) * 100), 0)
      return centavos === 185000 ? null : `soma dos avulsos ${centavos / 100}, esperado 1850 (1500 + 350 do seed)`
    },
  },
]

const supabase = createClient(URL_SUPABASE, ANON)
const login = await comNovaTentativa(`login de ${EMAIL}`, () =>
  supabase.auth.signInWithPassword({ email: EMAIL, password: SENHA }),
)

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
  // `exigeSeed`: a query tem seed próprio, então zero linha é dado faltando,
  // não "não exercitada" — antes ela passava calada sem provar nada.
  if (n === 0 && check.exigeSeed) {
    falhas += 1
    console.log(`  FALHA [${check.bloco}] ${check.nome}`)
    console.log(`         0 registro em gc-dev; aplique: bash scripts/banco/aplicar-seed.sh ${check.exigeSeed}`)
    continue
  }
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
