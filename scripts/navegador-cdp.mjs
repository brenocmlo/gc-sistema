/**
 * Driver CDP mínimo: Chrome headless dirigido pelo WebSocket nativo do Node 24.
 *
 * Existe pra a camada 7 (navegador) não trazer dependência nova. Playwright
 * resolveria, mas o projeto já usa o Chrome local em `scripts/docs-pdf.sh`, e o
 * Node 24 tem WebSocket embutido — então falar CDP direto custa este arquivo e
 * zero pacote.
 *
 * Só tem o que a camada usa: navegar, esperar condição, preencher, clicar de
 * verdade (mouse no ponto), screenshot e coleta de erro de console.
 */
export async function conectar({ porta = 9222 } = {}) {
  const versao = await (await fetch(`http://127.0.0.1:${porta}/json/version`)).json()
  const ws = new WebSocket(versao.webSocketDebuggerUrl)
  await new Promise((ok, erro) => { ws.onopen = ok; ws.onerror = erro })

  let seq = 0
  const pendentes = new Map()
  const ouvintes = []

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pendentes.has(msg.id)) {
      const { ok, erro } = pendentes.get(msg.id)
      pendentes.delete(msg.id)
      msg.error ? erro(new Error(JSON.stringify(msg.error))) : ok(msg.result)
    } else if (msg.method) {
      for (const l of ouvintes) l(msg)
    }
  }

  const enviar = (method, params = {}, sessionId) =>
    new Promise((ok, erro) => {
      const id = ++seq
      pendentes.set(id, { ok, erro })
      ws.send(JSON.stringify({ id, method, params, sessionId }))
      setTimeout(() => pendentes.has(id) && (pendentes.delete(id), erro(new Error(`timeout: ${method}`))), 30000)
    })

  const { targetId } = await enviar('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await enviar('Target.attachToTarget', { targetId, flatten: true })

  const cmd = (method, params) => enviar(method, params, sessionId)
  await cmd('Page.enable'); await cmd('Runtime.enable'); await cmd('Log.enable')
  await cmd('Network.enable'); await cmd('DOM.enable')

  const erros = []
  ouvintes.push((msg) => {
    if (msg.sessionId !== sessionId) return
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') erros.push(msg.params.entry.text)
    if (msg.method === 'Runtime.exceptionThrown') erros.push(msg.params.exceptionDetails.text)
  })

  const avaliar = async (expr) => {
    const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr)
    return r.result.value
  }

  return {
    erros,
    avaliar,
    /** Sessão anterior não pode vazar entre execuções: o perfil do Chrome persiste. */
    limparSessao: () => cmd('Network.clearBrowserCookies'),
    async ir(url) {
      await cmd('Page.navigate', { url })
      await this.esperar('document.readyState === "complete"')
    },
    async esperar(exprBooleana, { rotulo = exprBooleana, ms = 15000 } = {}) {
      const limite = Date.now() + ms
      while (Date.now() < limite) {
        if (await avaliar(`!!(${exprBooleana})`)) return true
        await new Promise((r) => setTimeout(r, 200))
      }
      throw new Error(`esperando demais por: ${rotulo}`)
    },
    /** Texto visível da página, normalizado. */
    texto: () => avaliar('document.body.innerText.replace(/\\s+/g, " ")'),
    url: () => avaliar('location.pathname + location.search'),
    async preencher(seletor, valor) {
      await avaliar(`(() => {
        const el = document.querySelector(${JSON.stringify(seletor)});
        if (!el) throw new Error('sem elemento: ' + ${JSON.stringify(seletor)});
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : el instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
        setter.call(el, ${JSON.stringify(String(valor))});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`)
    },
    /** Clique real: rola até o elemento e dispara mouse no ponto certo. */
    async clicar(seletorOuTexto, { texto = null } = {}) {
      const alvo = texto
        ? `Array.from(document.querySelectorAll(${JSON.stringify(seletorOuTexto)})).find(e => e.innerText.trim().includes(${JSON.stringify(texto)}))`
        : `document.querySelector(${JSON.stringify(seletorOuTexto)})`
      const caixa = await avaliar(`(() => {
        const el = ${alvo};
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`)
      if (!caixa) throw new Error(`sem elemento pra clicar: ${seletorOuTexto}${texto ? ` (texto ${texto})` : ''}`)
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cmd('Input.dispatchMouseEvent', { type, x: caixa.x, y: caixa.y, button: 'left', clickCount: 1 })
      }
    },
    /**
     * Aplica o viewport e espera o reflow — medir antes disso dá número errado.
     * `mobile: false` de propósito: com `true` o Chrome impõe um viewport
     * mínimo (~552px) e mascara justamente a largura estreita que se quer medir.
     */
    async viewport(largura, altura = 900) {
      await cmd('Emulation.setDeviceMetricsOverride', { width: largura, height: altura, deviceScaleFactor: 1, mobile: false })
      // setTimeout e não requestAnimationFrame: no headless o rAF depende de
      // pintura e às vezes não dispara depois de trocar o viewport — aí o
      // Runtime.evaluate fica pendurado até o timeout do comando.
      await avaliar('new Promise(r => setTimeout(r, 120))')
      return avaliar('window.innerWidth')
    },
    /**
     * Anexa um arquivo do disco a um `<input type="file">`, como o seletor do
     * sistema faria. É o único caminho: `input.files` é read-only em JS, então
     * sem `DOM.setFileInputFiles` não há como exercitar upload pela tela.
     */
    async anexarArquivo(seletor, caminhoAbsoluto) {
      const { root } = await cmd('DOM.getDocument', { depth: -1 })
      const { nodeId } = await cmd('DOM.querySelector', {
        nodeId: root.nodeId,
        selector: seletor,
      })
      if (!nodeId) throw new Error(`sem input de arquivo: ${seletor}`)
      await cmd('DOM.setFileInputFiles', { files: [caminhoAbsoluto], nodeId })
    },
    async screenshot(caminho, { largura = 1440, altura = 900 } = {}) {
      await this.viewport(largura, altura)
      const { data } = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
      const { writeFileSync } = await import('node:fs')
      writeFileSync(caminho, Buffer.from(data, 'base64'))
      return caminho
    },
    fechar: () => { try { ws.close() } catch {} },
  }
}
