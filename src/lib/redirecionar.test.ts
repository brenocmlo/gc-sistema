import test from 'node:test'
import assert from 'node:assert/strict'

import { urlNoMesmoHost } from './redirecionar.ts'

const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null })

test('redirect no mesmo host do pedido: host, proxy e sem cabeçalho', () => {
  assert.equal(urlNoMesmoHost(h({ host: '127.0.0.1:3112' }), 'http://localhost:3112/convite', '/convite/senha?tipo=invite').href, 'http://127.0.0.1:3112/convite/senha?tipo=invite')
  assert.equal(urlNoMesmoHost(h({ host: 'interno:3000', 'x-forwarded-host': 'gc.exemplo.com', 'x-forwarded-proto': 'https' }), 'http://interno:3000/sair', '/login?erro=inativo').href, 'https://gc.exemplo.com/login?erro=inativo')
  assert.equal(urlNoMesmoHost(h({}), 'http://localhost:3000/x', '/login').href, 'http://localhost:3000/login')
})
