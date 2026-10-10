/**
 * Matriz de RLS do 13.3: perfil × entidade × operação, testada célula a célula
 * em gc-dev contra `matriz-rls.json`. Chamada pela camada dados.
 *
 * Tabelas: um SQL só pela Management API (SUPABASE_ACCESS_TOKEN), que assume
 * o papel `authenticated` com o `sub` de cada usuário de teste, exatamente o
 * que o PostgREST faz com o JWT. Cada operação roda numa subtransação que
 * termina em exceção de propósito: insert, update e delete acontecem de
 * verdade, com triggers e policies, e são desfeitos. Nada fica no banco.
 *   - select: a linha de amostra aparece?
 *   - insert: cópia da amostra (sem id e sem coluna gerada). Recusa da RLS é
 *     SQLSTATE 42501; qualquer outro desfecho (gravou, número repetido, FK)
 *     quer dizer que a policy deixou passar, porque o Postgres confere a RLS
 *     antes das constraints.
 *   - update e delete: na linha de amostra. Zero linha afetada = a policy
 *     escondeu; uma linha, ou erro de trigger/FK depois de achar a linha = passou.
 *
 * Buckets: pela API de Storage com a sessão de cada perfil (o caminho real do
 * app), com arquivo criado pela chave de serviço e apagado no fim.
 */
import { readFileSync } from 'node:fs'

import { createClient } from '@supabase/supabase-js'

import { GC_DEV_REF, exigirGcDev, refDoProjeto } from '../comum/gc-dev-guard.mjs'
import { sessaoDePerfil, PERFIS_DE_TESTE } from '../comum/sessao-dev.mjs'

const ESPERADO = JSON.parse(readFileSync(new URL('./matriz-rls.json', import.meta.url), 'utf8'))
const OPS = ['select', 'insert', 'update', 'delete']

function pode(regra, perfil, perfis) {
  return (regra === 'todos' ? perfis : regra).includes(perfil)
}

async function sql(query) {
  const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL
  exigirGcDev(URL_SUPABASE, 'a matriz de RLS')
  const ref = refDoProjeto(URL_SUPABASE)
  if (ref !== GC_DEV_REF) throw new Error(`projeto ${ref} não é o gc-dev`)
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN ausente no .env.local')
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const corpo = await r.text()
  if (!r.ok) throw new Error(`Management API ${r.status}: ${corpo.slice(0, 300)}`)
  return JSON.parse(corpo)
}

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`

/** O SQL da matriz: uma função temporária que devolve as células em jsonb. */
function sqlDaMatriz(empresa, usuarios, amostraProfile) {
  const tabelas = Object.keys(ESPERADO.tabelas)
  return `
create function pg_temp.matriz_rls(p_empresa uuid, p_usuarios jsonb, p_amostra_profile uuid, p_tabelas text[])
returns jsonb language plpgsql as $f$
declare
  t text; op text; perfil text; uid text;
  amostra jsonb; id_amostra text; cols text; col_upd text;
  n bigint; res text; saida jsonb := '[]'::jsonb;
begin
  foreach t in array p_tabelas loop
    -- Linha de amostra da empresa dos usuários de teste, lida como dono.
    if t = 'empresas' then
      execute 'select to_jsonb(x) from empresas x where id = $1' into amostra using p_empresa;
    elsif t = 'profiles' then
      execute 'select to_jsonb(x) from profiles x where id = $1' into amostra using p_amostra_profile;
    elsif t = 'auditoria_eventos' then
      execute 'select to_jsonb(x) from auditoria_eventos x where empresa_id = $1 and entidade <> ''notas_fiscais'' order by id desc limit 1' into amostra using p_empresa;
    else
      execute format('select to_jsonb(x) from %I x where empresa_id = $1 order by x.id desc limit 1', t) into amostra using p_empresa;
    end if;
    if amostra is null then
      saida := saida || jsonb_build_object('tabela', t, 'op', '*', 'perfil', '*', 'res', 'sem_amostra');
      continue;
    end if;
    id_amostra := amostra->>'id';

    select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
      from pg_attribute a
     where a.attrelid = format('public.%I', t)::regclass and a.attnum > 0 and not a.attisdropped
       and a.attgenerated = '' and a.attidentity = '' and a.attname <> 'id';
    select coalesce(
      (select 'updated_at' from pg_attribute where attrelid = format('public.%I', t)::regclass and attname = 'updated_at' and not attisdropped),
      split_part(cols, ', ', 1)) into col_upd;

    foreach op in array array['select', 'insert', 'update', 'delete'] loop
      for perfil, uid in select key, value #>> '{}' from jsonb_each(p_usuarios) loop
        res := null;
        begin
          perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);
          perform set_config('role', 'authenticated', true);
          if op = 'select' then
            execute format('select count(*) from %I where id::text = $1', t) into n using id_amostra;
          elsif op = 'insert' then
            execute format('insert into %I (%s) select %s from jsonb_populate_record(null::%I, $1)', t, cols, cols, t) using amostra;
            n := 1;
          elsif op = 'update' then
            execute format('update %I set %I = %I where id::text = $1', t, col_upd, col_upd) using id_amostra;
            get diagnostics n = row_count;
          else
            execute format('delete from %I where id::text = $1', t) using id_amostra;
            get diagnostics n = row_count;
          end if;
          res := case when n > 0 then 'pode' else 'nao' end;
          raise exception using errcode = 'P0R15', message = 'desfaz';
        exception
          when sqlstate 'P0R15' then null;
          when insufficient_privilege then res := 'nao';
          when others then res := 'pode:' || sqlstate;
        end;
        saida := saida || jsonb_build_object('tabela', t, 'op', op, 'perfil', perfil, 'res', res);
      end loop;
    end loop;
  end loop;
  return saida;
end
$f$;
select pg_temp.matriz_rls(${lit(empresa)}::uuid, ${lit(JSON.stringify(usuarios))}::jsonb, ${lit(amostraProfile)}::uuid, array[${tabelas.map(lit).join(', ')}]::text[]) as matriz;
`
}

/** Usuários de teste (perfil → uuid) e a empresa deles. O admin é o da validação. */
async function usuariosDeTeste(svc) {
  const emails = { admin: process.env.VALIDACAO_EMAIL, ...PERFIS_DE_TESTE }
  const { data, error } = await svc.from('profiles').select('id, email, empresa_id').in('email', Object.values(emails))
  if (error) throw new Error(error.message)
  const usuarios = {}
  for (const [perfil, email] of Object.entries(emails)) {
    const p = data.find((x) => x.email === email)
    if (!p) throw new Error(`usuário de teste ${email} não existe`)
    usuarios[perfil] = p.id
  }
  const empresas = new Set(data.map((p) => p.empresa_id))
  if (empresas.size !== 1) throw new Error('os usuários de teste não são da mesma empresa')
  return { usuarios, empresa: [...empresas][0] }
}

async function matrizDasTabelas(svc) {
  const { usuarios, empresa } = await usuariosDeTeste(svc)
  // Para garantir as sessões no Auth (e que o usuário está ativo), pede uma de cada.
  for (const perfil of Object.keys(PERFIS_DE_TESTE)) await sessaoDePerfil(perfil)
  const linhas = await sql(sqlDaMatriz(empresa, usuarios, usuarios.medicao))
  const celulas = linhas[0]?.matriz ?? []
  const divergencias = []
  const semAmostra = []
  let conferidas = 0
  for (const c of celulas) {
    if (c.res === 'sem_amostra') { semAmostra.push(c.tabela); continue }
    const esperado = pode(ESPERADO.tabelas[c.tabela][c.op], c.perfil, ESPERADO.perfis)
    const obtido = c.res.startsWith('pode')
    conferidas += 1
    if (esperado !== obtido) divergencias.push(`${c.tabela}.${c.op} como ${c.perfil}: esperado ${esperado ? 'pode' : 'não pode'}, obtido ${c.res}`)
  }
  return { conferidas, divergencias, semAmostra }
}

async function matrizDosBuckets(svc) {
  const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL
  const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const { usuarios, empresa } = await usuariosDeTeste(svc)
  const marca = `rls-13-3-${Date.now()}`
  const pdf = new Blob(['%PDF-1.4\n% matriz de RLS do 13.3\n'], { type: 'application/pdf' })
  const divergencias = []
  const criados = []
  let conferidas = 0

  const clientes = {}
  for (const perfil of ESPERADO.perfis) {
    const c = createClient(URL_SUPABASE, ANON, { auth: { persistSession: false } })
    if (perfil === 'admin') {
      const r = await c.auth.signInWithPassword({ email: process.env.VALIDACAO_EMAIL, password: process.env.VALIDACAO_SENHA })
      if (r.error) throw new Error(`login do admin: ${r.error.message}`)
    } else {
      await c.auth.setSession((await sessaoDePerfil(perfil)).session)
    }
    clientes[perfil] = c
  }

  const existe = async (bucket, caminho) => {
    const pasta = caminho.split('/').slice(0, -1).join('/')
    const nome = caminho.split('/').pop()
    const { data } = await svc.storage.from(bucket).list(pasta, { search: nome })
    return (data ?? []).some((f) => f.name === nome)
  }
  const conferir = (chave, op, perfil, obtido, erro = null) => {
    conferidas += 1
    const esperado = pode(ESPERADO.buckets[chave][op], perfil, ESPERADO.perfis)
    if (esperado !== obtido) {
      divergencias.push(`${chave}.${op} como ${perfil}: esperado ${esperado ? 'pode' : 'não pode'}, obtido ${obtido ? 'pode' : 'não pode'}${erro ? ` (${erro})` : ''}`)
    }
  }
  // Erro de rede não é recusa da policy: refaz uma vez antes de concluir.
  const comNovaTentativa = async (fn) => {
    const r = await fn()
    if (!r.error || /row-level security|not found|unauthorized|403|400/i.test(`${r.error.message} ${r.error.statusCode ?? ''}`)) return r
    return fn()
  }

  try {
    for (const chave of Object.keys(ESPERADO.buckets)) {
      const [bucket, sub] = chave.split('/')
      const pasta = sub ? `${empresa}/${marca}/${sub}` : `${empresa}/${marca}`
      for (const perfil of ESPERADO.perfis) {
        const c = clientes[perfil]
        // select: arquivo da empresa, criado pela chave de serviço.
        const alvo = `${pasta}/ler-${perfil}.pdf`
        const up = await svc.storage.from(bucket).upload(alvo, pdf, { contentType: 'application/pdf' })
        if (up.error) throw new Error(`svc não criou ${bucket}/${alvo}: ${up.error.message}`)
        criados.push([bucket, alvo])
        const dl = await comNovaTentativa(() => c.storage.from(bucket).download(alvo))
        conferir(chave, 'select', perfil, !dl.error, dl.error ? `${dl.error.name ?? ''} ${dl.error.message ?? ''} ${dl.error.statusCode ?? ''}`.trim() : null)
        // insert: o próprio perfil envia.
        const novo = `${pasta}/enviar-${perfil}.pdf`
        const ins = await comNovaTentativa(() => c.storage.from(bucket).upload(novo, pdf, { contentType: 'application/pdf' }))
        if (!ins.error) criados.push([bucket, novo])
        conferir(chave, 'insert', perfil, !ins.error, ins.error?.message ?? null)
        // delete: o perfil tenta apagar o arquivo que a chave de serviço criou.
        await c.storage.from(bucket).remove([alvo])
        conferir(chave, 'delete', perfil, !(await existe(bucket, alvo)))
      }
    }
  } finally {
    const porBucket = new Map()
    for (const [b, p] of criados) porBucket.set(b, [...(porBucket.get(b) ?? []), p])
    for (const [b, ps] of porBucket) await svc.storage.from(b).remove(ps)
  }
  return { conferidas, divergencias }
}

/** Roda as duas partes. Devolve o resumo para a camada dados. */
export async function rodarMatrizRls() {
  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const tabelas = await matrizDasTabelas(svc)
  const buckets = await matrizDosBuckets(svc)
  // Quantas células a matriz tem: para a camada saber se alguma não rodou.
  const esperadas = {
    tabelas: Object.keys(ESPERADO.tabelas).length * OPS.length * ESPERADO.perfis.length,
    buckets: Object.keys(ESPERADO.buckets).length * 3 * ESPERADO.perfis.length,
  }
  return { tabelas, buckets, esperadas }
}

// Sozinho: node --env-file=.env.local scripts/validacao/matriz-rls.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await rodarMatrizRls()
  console.log(`tabelas: ${r.tabelas.conferidas} células, ${r.tabelas.divergencias.length} divergência(s)${r.tabelas.semAmostra.length ? `, sem amostra: ${r.tabelas.semAmostra.join(', ')}` : ''}`)
  for (const d of r.tabelas.divergencias) console.log(`  ${d}`)
  console.log(`buckets: ${r.buckets.conferidas} células, ${r.buckets.divergencias.length} divergência(s)`)
  for (const d of r.buckets.divergencias) console.log(`  ${d}`)
}
