import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  caminhoDaEvidencia,
  caminhoEhDaEvidencia,
  EVIDENCIA_MAX_BYTES,
  EVIDENCIA_TIPOS,
  evidenciasDaEtapa,
  lerEvidencias,
  pastaDaEvidencia,
  temMiniatura,
  tipoDaEvidencia,
  validarEvidencia,
  type Evidencia,
} from './evidencias.ts'

const D = {
  empresaId: '11111111-1111-1111-1111-111111111111',
  obraId: '22222222-2222-2222-2222-222222222222',
  execucaoId: '33333333-3333-3333-3333-333333333333',
  etapa: 'inst' as const,
}

test('a lista de tipos é igual ao allowed_mime_types do bucket evidencias', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20260424121552_storage_buckets.sql', import.meta.url), 'utf8')
  const bloco = sql.slice(sql.indexOf("'evidencias',"), sql.indexOf("'notas-fiscais',"))
  const doBucket = Array.from(bloco.matchAll(/'([a-z]+\/[a-z0-9.+-]+)'/g), (m) => m[1]).sort()
  assert.deepEqual(Array.from(new Set(Object.values(EVIDENCIA_TIPOS))).sort(), doBucket)
  assert.match(bloco, /20971520/)
  assert.equal(EVIDENCIA_MAX_BYTES, 20971520)
})

test('validarEvidencia aceita PDF e as quatro imagens, pela extensão, mesmo com tipo vazio', () => {
  for (const name of ['a.pdf', 'b.JPG', 'c.jpeg', 'd.png', 'e.webp', 'IMG_0001.HEIC']) {
    assert.equal(validarEvidencia({ name, size: 1000, type: '' }), null, name)
  }
  assert.equal(tipoDaEvidencia({ name: 'IMG_0001.HEIC', size: 1 }), 'image/heic')
})

test('validarEvidencia recusa outro tipo, arquivo vazio e acima de 20 MB', () => {
  assert.match(validarEvidencia({ name: 'planilha.xlsx', size: 10 }) ?? '', /PDF ou imagem/)
  assert.match(validarEvidencia({ name: 'foto.gif', size: 10 }) ?? '', /PDF ou imagem/)
  assert.match(validarEvidencia({ name: 'foto.jpg', size: 0 }) ?? '', /vazio/)
  assert.match(validarEvidencia({ name: 'foto.jpg', size: EVIDENCIA_MAX_BYTES + 1 }) ?? '', /20 MB/)
  assert.equal(validarEvidencia({ name: 'foto.jpg', size: EVIDENCIA_MAX_BYTES }), null)
})

test('caminho segue {empresa}/{obra}/execucao/{execucao}/{etapa}/{ts}_{nome limpo}', () => {
  assert.equal(pastaDaEvidencia(D), `${D.empresaId}/${D.obraId}/execucao/${D.execucaoId}/inst/`)
  assert.equal(caminhoDaEvidencia(D, 'Foto Instalação 1.JPG', 42), `${pastaDaEvidencia(D)}42_foto_instalacao_1.jpg`)
})

test('caminhoEhDaEvidencia só aceita arquivo direto na pasta da execução e da etapa', () => {
  const certo = caminhoDaEvidencia(D, 'a.jpg', 1)
  assert.equal(caminhoEhDaEvidencia(certo, D), true)
  assert.equal(caminhoEhDaEvidencia(certo, { ...D, etapa: 'fab' }), false, 'outra etapa')
  assert.equal(caminhoEhDaEvidencia(certo, { ...D, execucaoId: 'outra' }), false, 'outra execução')
  assert.equal(caminhoEhDaEvidencia(`${pastaDaEvidencia(D)}sub/a.jpg`, D), false, 'subpasta')
  assert.equal(caminhoEhDaEvidencia(`${pastaDaEvidencia(D)}../../x/a.jpg`, D), false, '..')
  assert.equal(caminhoEhDaEvidencia(pastaDaEvidencia(D), D), false, 'só a pasta')
})

test('lerEvidencias descarta o que não tem path ou etapa válida; evidenciasDaEtapa filtra e ordena da mais nova', () => {
  const base = { nome: 'x', tipo: 'image/png', tamanho: 1, uploaded_by: 'u' }
  const lidas = lerEvidencias([
    { ...base, path: 'a', etapa: 'fab', uploaded_at: '2026-09-25T10:00:00Z' },
    { ...base, path: 'b', etapa: 'fab', uploaded_at: '2026-09-25T12:00:00Z' },
    { ...base, path: 'c', etapa: 'med', uploaded_at: '2026-09-25T11:00:00Z' },
    { ...base, path: 'd', etapa: 'outra', uploaded_at: '2026-09-25T11:00:00Z' },
    { ...base, etapa: 'fab' },
    null,
  ])
  assert.deepEqual(lidas.map((e) => e.path), ['a', 'b', 'c'])
  assert.deepEqual(evidenciasDaEtapa(lidas, 'fab').map((e) => e.path), ['b', 'a'])
  assert.deepEqual(evidenciasDaEtapa(lidas, 'ent'), [])
  assert.deepEqual(lerEvidencias(null), [])
  assert.deepEqual(lerEvidencias({}), [])
})

test('temMiniatura: JPG, PNG e WebP sim; HEIC e PDF não', () => {
  const t = (tipo: string) => temMiniatura({ tipo } as Evidencia)
  assert.deepEqual(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'].map(t), [true, true, true, false, false])
})
