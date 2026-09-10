/**
 * Camada 7 (navegador): usa a aplicação como uma pessoa usaria — login pela
 * tela, clique nos botões, formulário preenchido, diálogo aberto.
 *
 * Rodar via `bash scripts/validar.sh navegador`. Precisa do `next dev` no ar e
 * do Chrome com `--remote-debugging-port` (o validar.sh sobe os dois).
 *
 * Por que existe: a camada 6 chama as Server Actions direto, então prova o
 * servidor mas não a tela. O que só o navegador exercita é o que roda no
 * cliente — zod do react-hook-form, o cálculo ao vivo do valor final, o aviso
 * de soma acima de 100%, a lógica condicional do diálogo de status, o toast e
 * a navegação depois do sucesso. Era a última pendência de Propostas.
 *
 * Limpa o que cria: a proposta nasce `RUN-<hhmmss>` e é excluída pela própria
 * tela no fim do roteiro, o que de quebra exercita o ConfirmDialog.
 *
 * Screenshots vão pra /tmp/gc-validacao/shots (ou $VALIDACAO_SHOTS) — servem de evidência da conferência
 * visual, e é neles que se olha quando um passo falha.
 */
import { mkdirSync, writeFileSync } from 'node:fs'

import { exigirGcDev } from './gc-dev-guard.mjs'
import { conectar } from './navegador-cdp.mjs'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3111'
const EMAIL = process.env.VALIDACAO_EMAIL
const SENHA = process.env.VALIDACAO_SENHA
const SHOTS = process.env.VALIDACAO_SHOTS ?? '/tmp/gc-validacao/shots'
mkdirSync(SHOTS, { recursive: true })

if (!EMAIL || !SENHA) {
  console.error('FALHA: camada navegador precisa de VALIDACAO_EMAIL e VALIDACAO_SENHA.')
  process.exit(1)
}

exigirGcDev(process.env.NEXT_PUBLIC_SUPABASE_URL, 'a camada de navegador')

const NUMERO = `RUN-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`
let passos = 0, falhas = 0

function checar(desc, cond, detalhe = '') {
  passos++
  if (cond) console.log(`  ok    ${desc}`)
  else { falhas++; console.log(`  FALHA ${desc}`); if (detalhe) console.log(`         ${String(detalhe).slice(0, 300)}`) }
}

const b = await conectar()

try {
  await b.limparSessao()

  // 1. Sem sessão o guard manda pro login
  await b.ir(`${BASE}/propostas`)
  checar('sem sessão, /propostas redireciona pro /login', (await b.url()).startsWith('/login'), await b.url())
  await b.screenshot(`${SHOTS}/01-login.png`)

  // 2. Login pela tela — formulário de verdade
  await b.preencher('#email', EMAIL)
  await b.preencher('#password', SENHA)
  await b.clicar('button[type="submit"]')
  await b.esperar('location.pathname !== "/login"', { rotulo: 'sair do /login', ms: 20000 })
  checar('login pela tela funciona', !(await b.url()).startsWith('/login'), await b.url())

  // 3. Listagem
  await b.ir(`${BASE}/propostas`)
  await b.esperar('document.querySelector("table")', { rotulo: 'tabela da listagem' })
  const listagem = await b.texto()
  checar('listagem mostra as colunas', listagem.includes('Data emissão') && listagem.includes('Valor final'), listagem.slice(0, 200))
  await b.screenshot(`${SHOTS}/02-listagem.png`)
  await b.screenshot(`${SHOTS}/03-listagem-390.png`, { largura: 390, altura: 844 })

  // 4. Clicar em "Nova proposta"
  await b.clicar('a', { texto: 'Nova proposta' })
  await b.esperar('location.pathname === "/propostas/nova"', { rotulo: '/propostas/nova' })
  await b.esperar('document.querySelector("#numero")')
  checar('botão "Nova proposta" navega', (await b.url()) === '/propostas/nova')

  // 5. Preencher o formulário — o que nenhuma camada exercitava
  const primeiraObra = await b.avaliar(`(() => {
    const s = document.querySelector('#obra_id');
    const o = Array.from(s.options).find(o => o.value);
    return o ? o.value : null;
  })()`)
  checar('select de obra vem populado', !!primeiraObra, primeiraObra)

  await b.preencher('#numero', NUMERO)
  await b.preencher('#obra_id', primeiraObra)
  await b.preencher('#valor_total', '1000')
  await b.preencher('#desconto', '100')

  // Valor final é read-only e calculado na tela
  const valorFinal = await b.avaliar('document.querySelector("#valor_final_preview").value')
  checar('valor final calcula na tela (1000 − 100)', /900/.test(valorFinal), valorFinal)

  // Soma dos pct_* acima de 100% precisa avisar ANTES de submeter
  await b.preencher('#pct_sinal', '60')
  await b.preencher('#pct_fd', '60')
  const somaRuim = await b.texto()
  checar('soma acima de 100% é sinalizada na tela', somaRuim.includes('120%'), somaRuim.match(/Soma[^·]{0,60}/)?.[0])
  await b.screenshot(`${SHOTS}/04-form-soma-invalida.png`)

  // Tentar salvar assim: o zod do cliente tem que barrar
  await b.clicar('button[type="submit"]')
  await new Promise((r) => setTimeout(r, 1200))
  const barrado = await b.texto()
  checar('zod do cliente barra a soma > 100%',
    (await b.url()) === '/propostas/nova' && /não pode passar de 100%/i.test(barrado),
    barrado.match(/[^.]*100%[^.]*/)?.[0])

  // Corrigir e salvar
  await b.preencher('#pct_sinal', '50')
  await b.preencher('#pct_fd', '50')
  await b.preencher('#descricao', 'Criada pelo /run, clicando na tela.')
  await b.clicar('button[type="submit"]')
  await b.esperar('/^\\/propostas\\/[0-9a-f-]{36}$/.test(location.pathname)', { rotulo: 'ir pro detalhe', ms: 25000 })
  const idCriado = (await b.url()).split('/')[2]
  checar('formulário salva e navega pro detalhe', !!idCriado, await b.url())

  // 6. Detalhe carregado (o toast de criação é aferido no de status, abaixo:
  //    em `next dev` a primeira compilação de /propostas/[id] leva mais que os
  //    ~4s de vida do toast, então ele já expirou quando a página aparece.)
  await b.esperar(`document.body.innerText.includes(${JSON.stringify(NUMERO)})`)
  checar('detalhe abre com o número criado', (await b.texto()).includes(NUMERO))
  await b.screenshot(`${SHOTS}/05-detalhe.png`)

  // 7. Abas do detalhe
  const detalhe = await b.texto()
  checar('detalhe mostra as seis abas',
    ['Detalhes', 'Pagamento', 'Itens', 'Anexos', 'Histórico', 'Financeiro'].every((t) => detalhe.includes(t)))

  await b.clicar('button[role="tab"]', { texto: 'Pagamento' })
  await b.esperar('document.body.innerText.includes("Sinal")')
  const pagamento = await b.texto()
  checar('aba Pagamento rateia em reais', /R\$\s?450/.test(pagamento), pagamento.match(/Sinal[^A-Z]{0,40}/)?.[0])
  await b.screenshot(`${SHOTS}/06-aba-pagamento.png`)

  // 8. Diálogo de status — a lógica condicional que só o navegador exercita
  await b.clicar('button', { texto: 'Mudar status' })
  await b.esperar('document.querySelector("#novo_status")', { rotulo: 'diálogo de status' })
  const destinos = await b.avaliar('Array.from(document.querySelector("#novo_status").options).map(o => o.value).join(",")')
  checar('diálogo oferece só transições válidas (rascunho → enviada)', destinos === 'enviada', destinos)
  checar('campo data_envio aparece pro destino enviada', await b.avaliar('!!document.querySelector("#data_envio")'))
  await b.screenshot(`${SHOTS}/07-dialogo-status.png`)

  await b.clicar('button[type="submit"]', { texto: 'Salvar' })
  await b.esperar('!document.querySelector("#novo_status")', { rotulo: 'diálogo fechar', ms: 20000 })
  await b.esperar('document.body.innerText.includes("Enviada")', { rotulo: 'badge Enviada' })
  checar('status mudou pra Enviada pela tela', (await b.texto()).includes('Enviada'))
  const comToast = await b.texto()
  checar('toast de sucesso aparece', /status atualizado/i.test(comToast), comToast.slice(0, 160))

  // 9. Editar fica desabilitado fora de rascunho
  const editarDesabilitado = await b.avaliar(`(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(e => e.innerText.trim() === 'Editar');
    return btn ? btn.disabled : 'sem botão';
  })()`)
  checar('botão Editar desabilita fora de rascunho', editarDesabilitado === true, editarDesabilitado)

  // 10. Aba Histórico com a transição registrada
  await b.clicar('button[role="tab"]', { texto: 'Histórico' })
  await b.esperar('document.body.innerText.includes("Rascunho")')
  const hist = await b.texto()
  checar('aba Histórico mostra a transição e o autor',
    hist.includes('Rascunho') && hist.includes('Enviada') && /Breno/i.test(hist),
    hist.match(/Rascunho[^|]{0,80}/)?.[0])
  await b.screenshot(`${SHOTS}/08-aba-historico.png`)

  // 11. Anexo pela tela: o seletor de arquivo de verdade
  await b.clicar('button[role="tab"]', { texto: 'Anexos' })
  await b.esperar('document.querySelector(\'input[type="file"]\')', {
    rotulo: 'input de arquivo',
  })

  const arquivoLocal = `${SHOTS}/anexo-do-run.pdf`
  writeFileSync(arquivoLocal, Buffer.from('%PDF-1.4\n% anexo do roteiro\n'))

  // `input.files` é read-only em JS: sem DOM.setFileInputFiles não há como
  // exercitar o upload pela tela, só pela action.
  await b.anexarArquivo('input[type="file"]', arquivoLocal)

  // Esperar só o NOME aparecer é falso positivo: o FileUpload mostra o arquivo
  // na fila, com spinner, antes de o upload terminar. O que prova que gravou é
  // "Nenhum anexo ainda" sair da tela — a lista só some quando tem item — e o
  // botão de excluir do anexo existir.
  await b.esperar(
    '!document.body.innerText.includes("Nenhum anexo ainda")',
    { rotulo: 'anexo entrar na lista salva', ms: 30000 },
  )
  await b.esperar(
    'document.querySelector(\'button[aria-label^="Excluir anexo-do-run"]\')',
    { rotulo: 'botão de excluir do anexo', ms: 15000 },
  )
  checar(
    'anexo sobe pelo seletor de arquivo da tela',
    (await b.texto()).includes('anexo-do-run.pdf') &&
      !(await b.texto()).includes('Nenhum anexo ainda'),
  )
  await b.screenshot(`${SHOTS}/11-anexo-na-tela.png`)

  // E remover pelo botão, com o ConfirmDialog do anexo
  await b.clicar('button[aria-label^="Excluir anexo-do-run"]')
  await b.esperar('document.body.innerText.includes("Excluir anexo?")', {
    rotulo: 'ConfirmDialog do anexo',
  })
  await b.clicar('[role="dialog"] button', { texto: 'Excluir' })

  // O nome NÃO sai da tela: o FileUpload mantém a fila com "Limpar lista"
  // depois do upload, então esperar o texto desaparecer estoura sem motivo. O
  // que prova a remoção é a lista salva voltar ao estado vazio.
  await b.esperar('document.body.innerText.includes("Nenhum anexo ainda")', {
    rotulo: 'lista de anexos voltar a vazia',
    ms: 25000,
  })
  checar(
    'anexo é removido pela tela',
    !(await b.avaliar('!!document.querySelector(\'button[aria-label^="Excluir anexo-do-run"]\')')),
  )

  // 12. Excluir pela tela, com o ConfirmDialog
  await b.clicar('button', { texto: 'Excluir' })
  await b.esperar('document.body.innerText.includes("Excluir proposta?")', { rotulo: 'ConfirmDialog' })
  await b.screenshot(`${SHOTS}/09-confirm-excluir.png`)
  // "Excluir" aparece duas vezes: no header e no diálogo. Sem escopo, o clique
  // volta pro botão do header e o diálogo nunca confirma.
  await b.clicar('[role="dialog"] button', { texto: 'Excluir' })
  await b.esperar('location.pathname === "/propostas"', { rotulo: 'voltar pra listagem', ms: 20000 })
  const depois = await b.texto()
  checar('exclusão pela tela funciona e nada sobra', !depois.includes(NUMERO), NUMERO)
  await b.screenshot(`${SHOTS}/10-final.png`)

  const errosReais = b.erros.filter((e) => !/favicon|Download the React DevTools/i.test(e))
  checar('nenhum erro de console', errosReais.length === 0, errosReais.join(' | '))
} catch (e) {
  falhas++
  console.log(`  FALHA no roteiro: ${e.message}`)
  try { await b.screenshot(`${SHOTS}/99-erro.png`) } catch {}
} finally {
  b.fechar()
}

console.log(`\n${passos - falhas}/${passos} passos ok · screenshots em ${SHOTS}`)
process.exit(falhas === 0 ? 0 : 1)
