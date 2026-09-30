/**
 * Receptor local no lugar do webhook do n8n, para a camada escrita.
 *
 * O envio de documento pela tela (`registrarEnvioDocumento`) chama o webhook
 * "Processar Documento" do n8n. Contra o n8n de verdade o passo só rodava com
 * VALIDACAO_ENVIO_REAL=1 e, sem ele, era pulado — o plano nunca provava o que
 * o app manda. O validar.sh sobe isto e aponta N8N_DOCUMENTO_WEBHOOK_URL para
 * cá; o roteiro da escrita lê o que chegou em GET /recebidos e confere token,
 * ids, canal e a URL assinada do PDF.
 *
 * NÃO prova o n8n: a leitura pela IA e a gravação de volta são da trilha de
 * automação. Com VALIDACAO_ENVIO_REAL=1 o validar.sh não sobe o receptor e o
 * envio vai para o n8n configurado no .env.local, como antes.
 *
 * Uso: node scripts/validacao/receptor-n8n.mjs <porta>
 */
import { createServer } from 'node:http'

const porta = Number(process.argv[2] ?? 3113)
const recebidos = []

createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/recebidos') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(recebidos))
    return
  }
  if (req.method !== 'POST') {
    res.writeHead(405).end()
    return
  }
  let corpo = ''
  req.on('data', (c) => (corpo += c))
  req.on('end', () => {
    let json = null
    try {
      json = JSON.parse(corpo)
    } catch {
      // Fica null: o roteiro acusa corpo que não é JSON.
    }
    recebidos.push({
      caminho: req.url,
      token: req.headers['x-documento-token'] ?? null,
      contentType: req.headers['content-type'] ?? null,
      corpo: json,
    })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{"ok":true}')
  })
}).listen(porta, '127.0.0.1', () => console.log(`  receptor do n8n em 127.0.0.1:${porta}`))
