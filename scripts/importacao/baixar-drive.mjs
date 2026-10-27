/**
 * Documentos do Google Drive (sprint 14, bloco 14.6): a opção (b) da decisão 4
 * do 14.1, "baixar e guardar os arquivos no sistema". Só vale se a equipe
 * escolher (b); com (a), o 14.2 já deixa o link na observação e este script
 * não roda.
 *
 *   node --env-file=.env.local scripts/importacao/baixar-drive.mjs <planilha.xlsx>                     # simulação: lista links e destinos; não baixa, não conecta
 *   node --env-file=.env.local scripts/importacao/baixar-drive.mjs <planilha.xlsx> --baixar-para <dir> # simulação + baixa para uma pasta local (prova o acesso aos arquivos)
 *   node --env-file=.env.local scripts/importacao/baixar-drive.mjs <planilha.xlsx> --gravar            # baixa, sobe no Storage e aponta o registro (gc-dev)
 *   node --env-file=.env.local scripts/importacao/baixar-drive.mjs <planilha.xlsx> --desfazer          # tira do Storage e devolve o link à observação
 *
 * Opções: --mapa <json> (padrão: mapa-planilha.json ao lado), --ate AAAA-MM-DD,
 * --autor <email> (padrão: VALIDACAO_EMAIL; define empresa e uploaded_by),
 * --relatorio <json>.
 *
 * Lê a planilha com os MESMOS módulos do importador (ler-planilha +
 * montar-registros), então o link que ele acha é exatamente o texto que o
 * 14.2 gravou na observação:
 *
 *   proposta  → "Documento: <link>"            → bucket anexos,     jsonb propostas.anexos,
 *               caminho {empresa}/propostas/{proposta}/{ts}_{nome}         (buildStoragePath, como a aba Anexos)
 *   pagamento → "Arquivo: <link>" + [importacao:…] → bucket anexos,  coluna pagamentos.anexo,
 *               caminho {empresa}/{obra}/pagamentos/{pagamento}/{ts}_comprovante.ext (caminhoDoComprovante, 10.4)
 *   FD        → "Arquivo: <link>" + [importacao:…] → bucket evidencias, jsonb fd.evidencias,
 *               caminho {empresa}/{obra}/{fd}/{ts}_{nome}                  (como uploadEvidencia do FD)
 *
 * Depois de subir, a linha do link vira
 *   "<Documento|Arquivo> migrado do Drive para o sistema: <nome> (origem: <link>) [drive:<id>|<caminho>]"
 * A marca [drive:…] é a idempotência (rodar de novo não sobe duas vezes) e o
 * que o --desfazer usa para achar o arquivo e devolver a linha original.
 * Pagamento e FD são achados pela marca [importacao:…] do 14.2; proposta, pelo
 * número.
 *
 * Download: sem credencial, pelo link público (uc?export=download&id=…),
 * tratando a página de confirmação de arquivo grande. Com GOOGLE_DRIVE_TOKEN
 * (token OAuth de uma conta de serviço com leitura nos arquivos), pela API do
 * Drive (files/<id>?alt=media; Google Docs saem exportados em PDF).
 *
 * A simulação não conecta no banco. --gravar e --desfazer só rodam em gc-dev
 * (scripts/comum/gc-dev-guard.mjs).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { exigirGcDev } from '../comum/gc-dev-guard.mjs'

import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE, buildStoragePath, fileExtension, sanitizeFilename } from '../../src/lib/files.ts'
import { BUCKET_COMPROVANTE, COMPROVANTE_MAX_BYTES, MIME_COMPROVANTE, caminhoDoComprovante } from '../../src/lib/pagamento-comprovante.ts'

import { lerPlanilha } from './ler-planilha.mjs'
import { montarRegistros } from './montar-registros.mjs'

// ---------------------------------------------------------------------------
// Destinos: bucket, tipos aceitos e teto, iguais aos da tela de cada entidade.
// ---------------------------------------------------------------------------

/** Os tipos do upload de evidência do FD (src/app/(app)/fd/[id]/actions.ts). */
const TIPOS_EVIDENCIA_FD = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

export const DESTINOS = {
  proposta: { bucket: 'anexos', tabela: 'propostas', prefixo: 'Documento', tipos: ALLOWED_MIME_TYPES, teto: MAX_FILE_SIZE, onde: 'propostas.anexos (jsonb)' },
  pagamento: { bucket: BUCKET_COMPROVANTE, tabela: 'pagamentos', prefixo: 'Arquivo', tipos: Object.values(MIME_COMPROVANTE), teto: COMPROVANTE_MAX_BYTES, onde: 'pagamentos.anexo (caminho)' },
  fd: { bucket: 'evidencias', tabela: 'fd', prefixo: 'Arquivo', tipos: TIPOS_EVIDENCIA_FD, teto: 20 * 1024 * 1024, onde: 'fd.evidencias (jsonb)' },
}

const EXTENSAO_DO_TIPO = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
}
const TIPO_DA_EXTENSAO = Object.fromEntries(Object.entries(EXTENSAO_DO_TIPO).map(([t, e]) => [e, t]))
TIPO_DA_EXTENSAO['.jpeg'] = 'image/jpeg'

// ---------------------------------------------------------------------------
// Regras puras: link → id, observação → link, linha migrada ↔ linha original.
// ---------------------------------------------------------------------------

/**
 * O id do arquivo num link do Drive, e o tipo do link. Aceita
 * drive.google.com/file/d/<id>, open?id=<id>, uc?id=<id>,
 * drive.usercontent.google.com/download?id=<id> e
 * docs.google.com/<document|spreadsheets|presentation>/d/<id> (Google Docs,
 * que só saem exportados). Pasta (drive/folders/<id>) não é arquivo: volta
 * com tipo 'pasta' para o relatório recusar.
 */
export function idDoDrive(link) {
  let u
  try { u = new URL(String(link ?? '').trim()) } catch { return null }
  const host = u.hostname.toLowerCase()
  if (!/(^|\.)(drive|docs)\.google\.com$|^drive\.usercontent\.google\.com$/.test(host)) return null
  const pasta = u.pathname.match(/\/folders\/([\w-]+)/)
  if (pasta) return { id: pasta[1], tipo: 'pasta' }
  const doc = u.pathname.match(/^\/(document|spreadsheets|presentation)\/d\/([\w-]+)/)
  if (doc) return { id: doc[2], tipo: `google-${doc[1]}` }
  const arquivo = u.pathname.match(/\/file\/d\/([\w-]+)/)
  if (arquivo) return { id: arquivo[1], tipo: 'arquivo' }
  const q = u.searchParams.get('id')
  if (q && /^[\w-]+$/.test(q)) return { id: q, tipo: 'arquivo' }
  return null
}

/** O link que o 14.2 gravou na observação ("Documento: …" ou "Arquivo: …"). */
export function linkDaObservacao(observacao, prefixo) {
  const m = String(observacao ?? '').match(new RegExp(`^${prefixo}: (\\S+)$`, 'm'))
  return m ? m[1] : null
}

const RE_MIGRADO = /^(Documento|Arquivo) migrado do Drive para o sistema: .* \(origem: (\S+)\) \[drive:([\w-]+)\|([^\]]+)\]$/m

export function linhaMigrada({ prefixo, nome, link, id, caminho }) {
  return `${prefixo} migrado do Drive para o sistema: ${nome} (origem: ${link}) [drive:${id}|${caminho}]`
}

/** { prefixo, link, id, caminho } da linha migrada, ou null. */
export function lerLinhaMigrada(observacao) {
  const m = String(observacao ?? '').match(RE_MIGRADO)
  return m ? { linha: m[0], prefixo: m[1], link: m[2], id: m[3], caminho: m[4] } : null
}

/** Os alvos do download a partir dos registros montados pelo 14.2. */
export function alvosDosRegistros(registros) {
  const alvos = []
  for (const p of registros.propostas) {
    const link = linkDaObservacao(p.observacao, 'Documento')
    if (link) alvos.push({ destino: 'proposta', ref: p.ref, chave: p.numero, rotulo: `proposta ${p.numero}`, link, drive: idDoDrive(link) })
  }
  for (const x of registros.pagamentos) {
    const link = linkDaObservacao(x.observacao, 'Arquivo')
    if (link) alvos.push({ destino: 'pagamento', ref: x.ref, chave: x.chave, rotulo: `pagamento da NF ${x.nota.split('|')[0]} em ${x.data_pagamento}`, link, drive: idDoDrive(link) })
  }
  for (const f of registros.fds) {
    const link = linkDaObservacao(f.observacao, 'Arquivo')
    if (link) alvos.push({ destino: 'fd', ref: f.ref, chave: f.chave, rotulo: `FD de ${f.fornecedor} em ${f.data_lancamento}`, link, drive: idDoDrive(link) })
  }
  return alvos
}

/** O tipo pelo começo do arquivo (pega HTML de erro com nome de PDF). */
export function tipoPeloConteudo(b) {
  const txt = (de, ate) => String.fromCharCode(...b.subarray(de, ate))
  if (txt(0, 4) === '%PDF') return 'application/pdf'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x89 && txt(1, 4) === 'PNG') return 'image/png'
  if (txt(0, 4) === 'RIFF' && txt(8, 12) === 'WEBP') return 'image/webp'
  if (txt(4, 8) === 'ftyp' && /hei[cfx]|mif1/.test(txt(8, 12))) return 'image/heic'
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return 'ole' // .doc/.xls legados
  if (txt(0, 2) === 'PK') return 'zip' // .docx/.xlsx
  if (/^\s*</.test(txt(0, 64))) return 'text/html'
  return null
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

function nomeDoCabecalho(cd) {
  if (!cd) return null
  const estrela = cd.match(/filename\*=UTF-8''([^;]+)/i)
  if (estrela) return decodeURIComponent(estrela[1])
  const simples = cd.match(/filename="?([^";]+)"?/i)
  return simples ? simples[1] : null
}

/** A página "não foi possível verificar vírus" do Drive: o formulário que confirma o download. */
export function urlDeConfirmacao(html) {
  const form = html.match(/<form[^>]+id="download-form"[^>]+action="([^"]+)"[\s\S]*?<\/form>/)
  if (form) {
    const url = new URL(form[1].replace(/&amp;/g, '&'))
    for (const m of form[0].matchAll(/<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"/g)) url.searchParams.set(m[1], m[2])
    return url.toString()
  }
  const antigo = html.match(/href="(\/uc\?export=download[^"]*confirm=[^"]+)"/)
  return antigo ? `https://drive.google.com${antigo[1].replace(/&amp;/g, '&')}` : null
}

/**
 * Baixa o arquivo. Devolve { ok, bytes, nome, tipo } ou { ok: false, erro }.
 * Sem token: link público. Com GOOGLE_DRIVE_TOKEN: API do Drive.
 */
export async function baixarDoDrive(drive, { token = process.env.GOOGLE_DRIVE_TOKEN } = {}) {
  if (drive.tipo === 'pasta') return { ok: false, erro: 'o link é de uma pasta, não de um arquivo' }
  const google = drive.tipo.startsWith('google-')
  let resp
  if (token) {
    const auth = { headers: { Authorization: `Bearer ${token}` } }
    const meta = await fetch(`https://www.googleapis.com/drive/v3/files/${drive.id}?fields=name,mimeType,size&supportsAllDrives=true`, auth)
    if (!meta.ok) return { ok: false, erro: `API do Drive: HTTP ${meta.status} ao ler os metadados (a conta de serviço tem leitura no arquivo?)` }
    const m = await meta.json()
    const nativo = m.mimeType?.startsWith('application/vnd.google-apps.')
    resp = await fetch(nativo
      ? `https://www.googleapis.com/drive/v3/files/${drive.id}/export?mimeType=application/pdf`
      : `https://www.googleapis.com/drive/v3/files/${drive.id}?alt=media&supportsAllDrives=true`, auth)
    if (!resp.ok) return { ok: false, erro: `API do Drive: HTTP ${resp.status} no download` }
    const bytes = new Uint8Array(await resp.arrayBuffer())
    return { ok: true, bytes, nome: nativo ? `${m.name}.pdf` : m.name, tipo: nativo ? 'application/pdf' : m.mimeType }
  }

  const url = google
    ? `https://docs.google.com/${drive.tipo.slice(7)}/d/${drive.id}/export?format=pdf`
    : `https://drive.google.com/uc?export=download&id=${drive.id}`
  resp = await fetch(url, { redirect: 'follow' })
  for (let tentativa = 0; tentativa < 2 && (resp.headers.get('content-type') ?? '').includes('text/html'); tentativa++) {
    const html = await resp.text()
    if (/accounts\.google\.com|ServiceLogin|Você precisa de permissão|You need access|Request access/i.test(html)) {
      return { ok: false, erro: 'o arquivo não é público: peça o compartilhamento ou use GOOGLE_DRIVE_TOKEN (conta de serviço)' }
    }
    const confirmar = urlDeConfirmacao(html)
    if (!confirmar) return { ok: false, erro: `o Drive devolveu uma página HTML, não o arquivo (HTTP ${resp.status})` }
    resp = await fetch(confirmar, { redirect: 'follow' })
  }
  if (!resp.ok) return { ok: false, erro: `HTTP ${resp.status} no download` }
  if ((resp.headers.get('content-type') ?? '').includes('text/html')) return { ok: false, erro: 'o Drive insistiu na página de confirmação' }
  const bytes = new Uint8Array(await resp.arrayBuffer())
  const nome = nomeDoCabecalho(resp.headers.get('content-disposition')) ?? `drive-${drive.id}${google ? '.pdf' : ''}`
  return { ok: true, bytes, nome, tipo: (resp.headers.get('content-type') ?? '').split(';')[0].trim() || null }
}

/**
 * Confere o arquivo baixado contra o destino. Devolve { ok, nome, tipo } com o
 * tipo decidido pelo conteúdo (o cabeçalho do Drive costuma vir
 * application/octet-stream) ou { ok: false, erro }.
 */
export function conferirArquivo(arq, destino) {
  const d = DESTINOS[destino]
  if (arq.bytes.length === 0) return { ok: false, erro: 'arquivo vazio' }
  if (arq.bytes.length > d.teto) return { ok: false, erro: `${(arq.bytes.length / 1048576).toFixed(1)} MB passa do teto de ${d.teto / 1048576} MB da tela de ${destino}` }
  const peloConteudo = tipoPeloConteudo(arq.bytes)
  if (peloConteudo === 'text/html') return { ok: false, erro: 'o conteúdo é HTML (página do Drive), não o arquivo' }
  let tipo = peloConteudo
  // docx/xlsx/doc/xls não se distinguem pelos primeiros bytes: vale a extensão.
  if (peloConteudo === 'zip' || peloConteudo === 'ole' || !peloConteudo) tipo = TIPO_DA_EXTENSAO[fileExtension(arq.nome)] ?? arq.tipo
  if (!tipo || !d.tipos.includes(tipo)) return { ok: false, erro: `tipo ${tipo ?? 'desconhecido'} não é aceito em ${d.onde} (aceita: ${d.tipos.map((t) => EXTENSAO_DO_TIPO[t] ?? t).join(' ')})` }
  // Nome sem a extensão certa (o Drive às vezes devolve "documento"): acrescenta.
  const ext = EXTENSAO_DO_TIPO[tipo]
  const atual = fileExtension(arq.nome)
  const nome = TIPO_DA_EXTENSAO[atual] === tipo ? arq.nome : `${arq.nome}${ext}`
  return { ok: true, nome, tipo }
}

// ---------------------------------------------------------------------------
// Gravação e desfazer (só gc-dev)
// ---------------------------------------------------------------------------

async function acharRegistro(svc, alvo, empresaId) {
  const d = DESTINOS[alvo.destino]
  const colunas = { proposta: 'id, empresa_id, observacao, anexos', pagamento: 'id, empresa_id, obra_id, observacao, anexo', fd: 'id, empresa_id, obra_id, observacao, evidencias' }[alvo.destino]
  let q = svc.from(d.tabela).select(colunas).eq('empresa_id', empresaId)
  q = alvo.destino === 'proposta' ? q.eq('numero', alvo.chave) : q.like('observacao', `%[importacao:${alvo.chave}]%`)
  const { data, error } = await q
  if (error) return { erro: error.message }
  if (data.length > 1) return { erro: `${data.length} registros com a mesma chave` }
  return { registro: data[0] ?? null }
}

function caminhoNoBucket(alvo, reg, empresaId, nome, agora) {
  if (alvo.destino === 'proposta') return buildStoragePath(empresaId, 'propostas', reg.id, nome)
  if (alvo.destino === 'pagamento') return caminhoDoComprovante({ empresaId, obraId: reg.obra_id, pagamentoId: reg.id }, nome, agora)
  return `${empresaId}/${reg.obra_id}/${reg.id}/${agora}_${nome.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`
}

async function migrarUm(svc, alvo, { empresaId, autorId }) {
  const d = DESTINOS[alvo.destino]
  const achado = await acharRegistro(svc, alvo, empresaId)
  if (achado.erro) return { estado: 'falha', motivo: achado.erro }
  const reg = achado.registro
  if (!reg) return { estado: 'pendente', motivo: 'o registro não está no banco: rode importar-planilha.mjs --gravar antes' }
  const migrada = lerLinhaMigrada(reg.observacao)
  if (migrada && migrada.id === alvo.drive.id) return { estado: 'existente', caminho: migrada.caminho }
  if (linkDaObservacao(reg.observacao, d.prefixo) !== alvo.link) return { estado: 'pendente', motivo: 'a observação não tem mais o link do Drive (foi editada?); nada feito' }
  if (alvo.destino === 'pagamento' && reg.anexo) return { estado: 'pendente', motivo: 'o pagamento já tem comprovante enviado pela tela; não sobrescrevo' }

  const arq = await baixarDoDrive(alvo.drive)
  if (!arq.ok) return { estado: 'falha', motivo: arq.erro }
  const conf = conferirArquivo(arq, alvo.destino)
  if (!conf.ok) return { estado: 'falha', motivo: conf.erro }

  const agora = Date.now()
  const caminho = caminhoNoBucket(alvo, reg, empresaId, alvo.destino === 'proposta' ? conf.nome : sanitizeFilename(conf.nome), agora)
  if (!caminho) return { estado: 'falha', motivo: `extensão de ${conf.nome} não serve de comprovante` }
  const { error: eUp } = await svc.storage.from(d.bucket).upload(caminho, arq.bytes, { contentType: conf.tipo, upsert: false })
  if (eUp) return { estado: 'falha', motivo: `upload: ${eUp.message}` }

  // O mesmo formato de Anexo da aplicação (src/lib/types.ts).
  const anexo = { nome: conf.nome, path: caminho, tipo: conf.tipo, tamanho: arq.bytes.length, uploaded_at: new Date(agora).toISOString(), uploaded_by: autorId }
  const observacao = reg.observacao.replace(`${d.prefixo}: ${alvo.link}`, linhaMigrada({ prefixo: d.prefixo, nome: conf.nome, link: alvo.link, id: alvo.drive.id, caminho }))
  const patch = { observacao }
  if (alvo.destino === 'proposta') patch.anexos = [...(Array.isArray(reg.anexos) ? reg.anexos : []), anexo]
  if (alvo.destino === 'pagamento') patch.anexo = caminho
  if (alvo.destino === 'fd') patch.evidencias = [...(Array.isArray(reg.evidencias) ? reg.evidencias : []), anexo]
  // Só grava se a observação não mudou desde a leitura.
  const { data, error } = await svc.from(d.tabela).update(patch).eq('id', reg.id).eq('observacao', reg.observacao).select('id')
  if (error || data.length !== 1) {
    // Sem o registro apontando para ele, o arquivo ficaria órfão no bucket.
    await svc.storage.from(d.bucket).remove([caminho])
    return { estado: 'falha', motivo: error ? `registro: ${error.message}` : 'o registro mudou durante a migração; nada gravado' }
  }
  return { estado: 'criado', caminho, tamanho: arq.bytes.length, tipo: conf.tipo }
}

async function desfazerUm(svc, alvo, { empresaId }) {
  const d = DESTINOS[alvo.destino]
  const achado = await acharRegistro(svc, alvo, empresaId)
  if (achado.erro) return { estado: 'falha', motivo: achado.erro }
  const reg = achado.registro
  const migrada = reg && lerLinhaMigrada(reg.observacao)
  if (!migrada) return { estado: 'nada' }
  const { error: eRm } = await svc.storage.from(d.bucket).remove([migrada.caminho])
  if (eRm) return { estado: 'falha', motivo: `remover do Storage: ${eRm.message}` }
  const patch = { observacao: reg.observacao.replace(migrada.linha, `${migrada.prefixo}: ${migrada.link}`) }
  if (alvo.destino === 'proposta') patch.anexos = (reg.anexos ?? []).filter((a) => a?.path !== migrada.caminho)
  if (alvo.destino === 'pagamento' && reg.anexo === migrada.caminho) patch.anexo = null
  if (alvo.destino === 'fd') patch.evidencias = (reg.evidencias ?? []).filter((a) => a?.path !== migrada.caminho)
  const { error } = await svc.from(d.tabela).update(patch).eq('id', reg.id)
  if (error) return { estado: 'falha', motivo: `registro: ${error.message}` }
  return { estado: 'desfeito', caminho: migrada.caminho }
}

// ---------------------------------------------------------------------------
// Linha de comando
// ---------------------------------------------------------------------------

async function principal() {
  const args = process.argv.slice(2)
  const comValor = ['--mapa', '--ate', '--autor', '--relatorio', '--baixar-para']
  const opcao = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : undefined }
  const arquivo = args.find((a, i) => !a.startsWith('--') && !comValor.includes(args[i - 1]))
  const GRAVAR = args.includes('--gravar')
  const DESFAZER = args.includes('--desfazer')
  const baixarPara = opcao('--baixar-para')
  if (!arquivo) {
    console.error('Uso: node --env-file=.env.local scripts/importacao/baixar-drive.mjs <planilha.xlsx> [--gravar | --desfazer | --baixar-para <dir>] [--ate AAAA-MM-DD] [--mapa arquivo.json] [--autor email]')
    process.exit(2)
  }
  if (GRAVAR && DESFAZER) {
    console.error('FALHA: --gravar e --desfazer juntos não fazem sentido.')
    process.exit(2)
  }

  const mapa = JSON.parse(readFileSync(opcao('--mapa') ?? new URL('./mapa-planilha.json', import.meta.url), 'utf8'))
  const dataCorte = opcao('--ate') ?? mapa.data_corte ?? null
  const { resultado: lido } = await lerPlanilha(arquivo, mapa)
  const registros = montarRegistros(Object.fromEntries(Object.entries(lido).map(([k, v]) => [k, { linhas: v.linhas }])), mapa, { dataCorte })
  const alvos = alvosDosRegistros(registros)

  const modo = GRAVAR ? 'GRAVAR' : DESFAZER ? 'DESFAZER' : baixarPara ? `SIMULAÇÃO + download para ${baixarPara} (nada é gravado no banco)` : 'SIMULAÇÃO (não baixa, não conecta)'
  console.log(`\n  Documentos do Drive em ${arquivo}\n  modo: ${modo} · data de corte: ${dataCorte ?? 'nenhuma'}`)
  const porDestino = Object.fromEntries(Object.keys(DESTINOS).map((k) => [k, alvos.filter((a) => a.destino === k).length]))
  console.log(`  ${alvos.length} link(s): ${Object.entries(porDestino).map(([k, v]) => `${v} ${k}`).join(' · ')}\n`)
  for (const a of alvos) {
    const d = DESTINOS[a.destino]
    const id = !a.drive ? 'NÃO É LINK DO DRIVE' : a.drive.tipo === 'pasta' ? `PASTA ${a.drive.id} (não migra)` : `id ${a.drive.id}${a.drive.tipo !== 'arquivo' ? ` (${a.drive.tipo}, sai em PDF)` : ''}`
    console.log(`  ${a.ref.padEnd(18)} ${a.rotulo}`)
    console.log(`  ${''.padEnd(18)} ${a.link}`)
    console.log(`  ${''.padEnd(18)} → ${id} · bucket ${d.bucket} · ${d.onde}`)
  }
  const invalidos = alvos.filter((a) => !a.drive || a.drive.tipo === 'pasta')
  if (invalidos.length) console.log(`\n  ${invalidos.length} link(s) não migram sozinhos (não são arquivo do Drive); ficam como link na observação.`)
  const validos = alvos.filter((a) => a.drive && a.drive.tipo !== 'pasta')

  const resultado = []
  if (baixarPara && !GRAVAR && !DESFAZER) {
    mkdirSync(baixarPara, { recursive: true })
    console.log(`\n  download de prova (${process.env.GOOGLE_DRIVE_TOKEN ? 'API do Drive, com token' : 'link público'}):`)
    for (const a of validos) {
      const arq = await baixarDoDrive(a.drive)
      const conf = arq.ok ? conferirArquivo(arq, a.destino) : arq
      if (conf.ok) writeFileSync(join(baixarPara, `${a.drive.id}-${sanitizeFilename(conf.nome)}`), arq.bytes)
      resultado.push({ ref: a.ref, destino: a.destino, id: a.drive.id, ok: conf.ok, nome: conf.nome, tipo: conf.tipo, tamanho: arq.bytes?.length, erro: conf.erro })
      console.log(`    ${conf.ok ? 'OK   ' : 'FALHA'} ${a.ref}: ${conf.ok ? `${conf.nome} (${conf.tipo}, ${arq.bytes.length} bytes)` : conf.erro}`)
    }
  }

  if (GRAVAR || DESFAZER) {
    const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL
    exigirGcDev(URL_SUPABASE, 'a migração dos documentos do Drive')
    const { createClient } = await import('@supabase/supabase-js')
    const svc = createClient(URL_SUPABASE, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false } })
    const emailAutor = opcao('--autor') ?? process.env.VALIDACAO_EMAIL
    const { data: autor } = await svc.from('profiles').select('id, empresa_id, nome').eq('email', emailAutor).maybeSingle()
    if (!autor) {
      console.error(`FALHA: autor ${emailAutor} não tem perfil em gc-dev.`)
      process.exit(1)
    }
    console.log(`\n  ${GRAVAR ? 'gravando' : 'desfazendo'} como ${autor.nome}:`)
    for (const a of validos) {
      const r = GRAVAR ? await migrarUm(svc, a, { empresaId: autor.empresa_id, autorId: autor.id }) : await desfazerUm(svc, a, { empresaId: autor.empresa_id })
      resultado.push({ ref: a.ref, destino: a.destino, id: a.drive.id, ...r })
      console.log(`    ${r.estado.toUpperCase().padEnd(9)} ${a.ref}: ${r.caminho ?? r.motivo ?? ''}`)
    }
    const conta = (e) => resultado.filter((r) => r.estado === e).length
    console.log(GRAVAR
      ? `\n  ${conta('criado')} criado(s), ${conta('existente')} já migrado(s), ${conta('pendente')} pendente(s), ${conta('falha')} falha(s)`
      : `\n  ${conta('desfeito')} desfeito(s), ${conta('nada')} sem nada a desfazer, ${conta('falha')} falha(s)`)
  }

  const caminho = opcao('--relatorio') ?? join(tmpdir(), `drive-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(caminho, JSON.stringify({ arquivo, modo, dataCorte, alvos: alvos.map(({ destino, ref, chave, rotulo, link, drive }) => ({ destino, ref, chave, rotulo, link, drive, bucket: DESTINOS[destino].bucket })), resultado }, null, 2))
  console.log(`\n  relatório completo: ${caminho}`)
  process.exit(resultado.some((r) => r.estado === 'falha' || r.ok === false) ? 1 : 0)
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await principal()
