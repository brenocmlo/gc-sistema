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
import { limparAuditoriaDoRoteiro } from './auditoria-limpeza.mjs'
import { sessaoDePerfil } from './sessao-dev.mjs'

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
// Declarado aqui em cima: o roteiro chama clienteSupabase() antes da linha
// em que a função é declarada, e `let` embaixo cairia na zona morta.
let _sb = null
/** Início da rodada, com folga pro relógio do banco — ver auditoria-limpeza.mjs. */
const INICIO_AUDITORIA = new Date(Date.now() - 60_000).toISOString()

function checar(desc, cond, detalhe = '') {
  passos++
  if (cond) console.log(`  ok    ${desc}`)
  else { falhas++; console.log(`  FALHA ${desc}`); if (detalhe) console.log(`         ${String(detalhe).slice(0, 300)}`) }
}

const b = await conectar({ porta: Number(process.env.VALIDACAO_PORTA_CDP ?? 9222) })

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

  // 7b. Aba Itens (bloco 5.2) — tabela editável. Roda ANTES da mudança de
  // status de propósito: item só é editável em rascunho.
  await b.clicar('button[role="tab"]', { texto: 'Itens' })
  await b.esperar('document.body.innerText.includes("Adicionar item")', { rotulo: 'aba Itens' })
  checar('aba Itens abre vazia, com o botão de adicionar',
    (await b.texto()).includes('Nenhum item ainda'))

  await b.clicar('button', { texto: 'Adicionar item' })
  await b.esperar(
    'document.querySelector(\'table[aria-label="Itens da proposta"] input[aria-label="Quantidade"]\')',
    { rotulo: 'linha nova na tabela', ms: 25000 },
  )
  checar('adicionar item cria a linha sem sair da página',
    await b.avaliar(`location.pathname.startsWith('/propostas/') && !location.pathname.endsWith('/editar')`))

  // Edição inline: preencher NÃO dispara blur, e é o blur que salva.
  await b.preencher('input[aria-label="Quantidade"]', '3')
  await b.preencher('input[aria-label="Valor unitário"]', '250')
  await b.avaliar('document.querySelector(\'input[aria-label="Valor unitário"]\').blur(), true')

  // O que prova que gravou é o valor_total (coluna GENERATED) voltar do banco
  // com 750, não o input ter o texto digitado.
  await b.esperar('document.body.innerText.includes("750,00")',
    { rotulo: 'valor_total calculado pelo banco', ms: 25000 })
  checar('edição inline salva por linha e o banco calcula o total',
    (await b.texto()).includes('750,00'))

  // Largura e altura alimentam area_m2, a outra coluna GENERATED
  await b.preencher('input[aria-label="Largura"]', '2')
  await b.preencher('input[aria-label="Altura"]', '1.5')
  await b.avaliar('document.querySelector(\'input[aria-label="Altura"]\').blur(), true')
  await b.esperar('document.body.innerText.includes("9,00 m²")',
    { rotulo: 'area_m2 calculada pelo banco', ms: 25000 })
  checar('area_m2 vem calculada (2 × 1,5 × 3 = 9)',
    (await b.texto()).includes('9,00 m²'))

  const comRodape = await b.texto()
  checar('rodapé soma quantidade, área e valor',
    /1 item/.test(comRodape) && comRodape.includes('9,00 m²') && comRodape.includes('750,00'),
    comRodape.match(/1 item[\s\S]{0,120}/)?.[0])
  await b.screenshot(`${SHOTS}/06b-aba-itens.png`)

  // 7c. Formulário completo (bloco 5.3) — o modal, o zod do cliente e os dois
  // campos calculados em runtime.
  await b.clicar('button[aria-label^="Abrir formulário do item"]')
  await b.esperar('document.querySelector("#item_localizacao")', {
    rotulo: 'modal do formulário completo', ms: 20000,
  })
  checar('formulário completo abre com os campos que a tabela não tem',
    await b.avaliar('!!document.querySelector("#item_vidros") && !!document.querySelector("#item_observacao")'))

  // Área e valor total são calculados no cliente com a fórmula do banco.
  await b.preencher('#item_largura', '2')
  await b.preencher('#item_altura', '3')
  await b.preencher('#item_quantidade', '2')
  await b.preencher('#item_valor_unit', '150')
  await b.esperar('document.querySelector("#item_area_calculada").innerText.includes("12,00")', {
    rotulo: 'área calculada em runtime', ms: 10000,
  })
  const calculados = await b.avaliar(`JSON.stringify({
    area: document.querySelector('#item_area_calculada').innerText.trim(),
    total: document.querySelector('#item_total_calculado').innerText.trim(),
  })`)
  checar('área e valor total calculam em runtime como o banco (2×3×2=12, 150×2=300)',
    calculados.includes('12,00') && calculados.includes('300,00'), calculados)
  await b.screenshot(`${SHOTS}/06c-formulario-item.png`)

  // zod do cliente: quantidade tem de ser > 0
  await b.preencher('#item_quantidade', '0')
  await b.clicar('button[type="submit"]', { texto: 'Salvar item' })
  await b.esperar('document.body.innerText.includes("maior que zero")', {
    rotulo: 'erro do zod na quantidade', ms: 10000,
  })
  checar('zod do cliente barra quantidade zero',
    (await b.texto()).includes('maior que zero'))

  // Agora salva de verdade, com os campos que só o formulário tem
  await b.preencher('#item_quantidade', '2')
  await b.preencher('#item_localizacao', 'Fachada sul')
  await b.preencher('#item_vidros', 'Laminado 8+8')
  await b.preencher('#item_observacao', 'Escrito pelo formulário completo')
  await b.clicar('button[type="submit"]', { texto: 'Salvar item' })
  await b.esperar('!document.querySelector("#item_localizacao")', {
    rotulo: 'modal fechar depois de salvar', ms: 25000,
  })
  // ATENÇÃO: `formatCurrency` usa Intl pt-BR, que separa "R$" do número com
  // ESPAÇO NÃO-SEPARÁVEL (U+00A0). `includes('R$ 300,00')` com espaço comum
  // nunca casa — foi o que reprovou este passo na primeira tentativa, com o
  // valor correto na tela. Regex com \s resolve, porque \s cobre o nbsp.
  await b.esperar('/R\\$\\s?300,00/.test(document.body.innerText)', {
    rotulo: 'valor total do banco na tabela', ms: 25000,
  })
  checar('formulário completo salva e o banco calcula o total',
    /R\$\s?300,00/.test(await b.texto()))
  await b.esperar('!document.body.innerText.includes("Item atualizado")', {
    rotulo: 'toast do formulário sair', ms: 15000,
  })

  // Exclusão com confirmação
  await b.clicar('button[aria-label^="Excluir item"]')
  await b.esperar('document.querySelector(\'[role="dialog"]\')', { rotulo: 'diálogo de exclusão do item' })
  checar('excluir item pede confirmação',
    (await b.texto()).includes('Excluir item?'))
  await b.clicar('[role="dialog"] button', { texto: 'Excluir' })
  await b.esperar('document.body.innerText.includes("Nenhum item ainda")',
    { rotulo: 'item sair da tabela', ms: 25000 })
  checar('item excluído some da tabela', (await b.texto()).includes('Nenhum item ainda'))

  // O toast fica sobre a faixa de botões e o clique é por coordenada — esperar
  // ele sair antes do próximo passo (armadilha registrada na auditoria).
  await b.esperar('!document.body.innerText.includes("Item excluído")',
    { rotulo: 'toast do item sair', ms: 15000 })

  // 7d. Importação por planilha (blocos 5.4 e 5.8), com um .xlsx DE VERDADE:
  // a planilha de teste de 50 linhas do 5.8 (`scripts/planilha-teste.mjs`),
  // com 6 linhas que o preview tem de recusar, cada uma por um motivo.
  let esperadoPlanilha
  {
    const { planilhaDeTeste } = await import('./planilha-teste.mjs')
    const { buffer, esperado } = await planilhaDeTeste()
    esperadoPlanilha = esperado
    const planilha = `${SHOTS}/planilha-teste-50.xlsx`
    writeFileSync(planilha, buffer)
    const { INSTRUCOES_TEMPLATE } = await import('../src/lib/itens-form.ts')

    await b.clicar('button', { texto: 'Importar planilha' })
    await b.esperar('document.querySelector(\'input[aria-label="Planilha de itens"]\')', {
      rotulo: 'modal de importação', ms: 20000,
    })
    checar('link do template aponta pra rota do XLSX',
      await b.avaliar(`!!document.querySelector('a[href="/api/template/itens"]')`))
    await b.anexarArquivo('input[aria-label="Planilha de itens"]', planilha)
    await b.esperar('document.querySelector(\'table[aria-label="Preview da importação"]\')', {
      rotulo: 'preview da planilha', ms: 20000,
    })
    const preview = await b.texto()
    checar(`o preview lê as ${esperado.linhas} linhas: ${esperado.validas} válidas, ${esperado.comErro} com erro`,
      preview.includes(`${esperado.linhas} linhas`) && preview.includes(`${esperado.validas} válidas`) &&
        preview.includes(`${esperado.comErro} com erro`),
      preview.match(/Confira antes de gravar[\s\S]{0,80}/)?.[0])
    const motivos = [/linha de exemplo do template/, /Quantidade tem de ser maior que zero/, /Unidade tem de ser/,
      /Já existe um item com esse número/, /tem de ser inteiro/, /Valor unitário não pode ser negativo/]
    const faltam = motivos.filter((m) => !m.test(preview)).map(String)
    checar('cada uma das 6 linhas inválidas é recusada pelo seu motivo', faltam.length === 0, `sem: ${faltam.join(', ')}`)
    const primeiraLinha = await b.avaliar(`document.querySelector('table[aria-label="Preview da importação"] tbody tr td')?.innerText.trim()`)
    checar('o preview numera pela linha real do Excel (exemplo na linha 8, não na 2)',
      primeiraLinha === String(INSTRUCOES_TEMPLATE.length + 3), `primeira linha do preview: ${primeiraLinha}`)
    await b.screenshot(`${SHOTS}/06d-importar-preview.png`)

    await b.clicar('button', { texto: `Importar ${esperado.validas} itens` })
    await b.esperar(`document.querySelectorAll('table[aria-label="Itens da proposta"] input[aria-label="Tipo"]').length === ${esperado.validas}`, {
      rotulo: 'itens importados na tabela', ms: 45000,
    })
    checar(`importar grava só as ${esperado.validas} válidas, e elas aparecem na tabela`, true)
    checar('o relatório final diz quantos entraram e quantos ficaram de fora',
      new RegExp(`${esperado.validas} itens importados, ${esperado.comErro} ignorados`).test(await b.texto()))
    await b.esperar('!document.body.innerText.includes("itens importados")', { rotulo: 'toast da importação sair', ms: 15000 })
  }

  // 7e. Divergência resolvida pela tela (bloco 5.6). O trigger mantém o valor
  // igual à soma das linhas importadas; a divergência é criada do jeito que ela
  // acontece de verdade — escrita direta no valor, como o n8n faz — e o botão
  // tem de desfazê-la. Até 2026-09-22 esse clique não tinha cobertura.
  {
    const sb = await clienteSupabase()
    const idProposta = (await b.url()).split('/').pop()
    const { error: e1 } = await sb.from('propostas').update({ valor_total: 9999 }).eq('id', idProposta)
    checar('escrita direta cria a divergência', !e1, e1?.message)
    await b.ir(`${BASE}/propostas/${idProposta}`)
    await b.clicar('button[role="tab"]', { texto: 'Itens' })
    await b.esperar('document.querySelector(\'[data-testid="aviso-divergencia"]\')', {
      rotulo: 'aviso de divergência', ms: 20000,
    })
    const somaBR = esperadoPlanilha.soma.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    checar('o aviso mostra os dois valores', /9\.999,00/.test(await b.texto()) && (await b.texto()).includes(somaBR), somaBR)
    await b.clicar('button', { texto: 'Usar a soma dos itens' })
    await b.esperar('!document.querySelector(\'[data-testid="aviso-divergencia"]\')', {
      rotulo: 'aviso sumir depois do clique', ms: 25000,
    })
    const { data: depois } = await sb.from('propostas').select('valor_total').eq('id', idProposta).maybeSingle()
    checar('o clique em "Usar a soma dos itens" grava a soma e o aviso some',
      Math.abs(Number(depois?.valor_total) - esperadoPlanilha.soma) < 0.005, `valor=${depois?.valor_total} esperado=${esperadoPlanilha.soma}`)
    await b.esperar('!document.body.innerText.includes("ajustado para a soma")', { rotulo: 'toast do ajuste sair', ms: 15000 })
  }

  // 7f. Duplicar, reordenar e lote pela tela (bloco 5.7).
  {
    const sb = await clienteSupabase()
    const idProposta = (await b.url()).split('/').pop()
    const tiposNaTela = () => b.avaliar(`Array.from(document.querySelectorAll('table[aria-label="Itens da proposta"] tbody tr')).map(tr => tr.querySelector('input[aria-label="Tipo"]')?.value ?? '')`)
    const linhasNaTela = async () => (await tiposNaTela()).length
    const n0 = await linhasNaTela()

    // Duplicar o primeiro: a cópia vai para o fim com o próximo número.
    const primeiroTipo = (await tiposNaTela())[0]
    await b.clicar(`button[aria-label="Duplicar o item ${esperadoPlanilha.primeiroNumero}"]`)
    await b.esperar(`document.querySelectorAll('table[aria-label="Itens da proposta"] tbody tr').length === ${n0 + 1}`, {
      rotulo: 'linha duplicada', ms: 25000,
    })
    const tiposDup = await tiposNaTela()
    checar('duplicar pela tela põe a cópia no fim, com o mesmo tipo', tiposDup[tiposDup.length - 1] === primeiroTipo,
      `${primeiroTipo} → último=${tiposDup[tiposDup.length - 1]}`)
    await b.esperar('!document.body.innerText.includes("Item duplicado")', { rotulo: 'toast do duplicar sair', ms: 15000 })

    // Descer o primeiro: troca de lugar com o segundo.
    const [t1, t2] = await tiposNaTela()
    await b.clicar(`button[aria-label="Descer o item ${esperadoPlanilha.primeiroNumero}"]`)
    await b.esperar(`(() => { const t = Array.from(document.querySelectorAll('table[aria-label="Itens da proposta"] input[aria-label="Tipo"]')).map(i => i.value); return t[0] === ${JSON.stringify(t2)} && t[1] === ${JSON.stringify(t1)} })()`, {
      rotulo: 'linhas trocadas de lugar', ms: 25000,
    })
    checar('descer troca o item com o de baixo, pela tela', true)
    checar('o primeiro não tem como subir (botão desabilitado)',
      await b.avaliar(`document.querySelector('table[aria-label="Itens da proposta"] tbody tr button[aria-label^="Subir"]')?.disabled === true`))

    // Selecionar todos + ajuste de +10%, com prévia.
    await b.clicar('input[aria-label="Selecionar todos os itens"]')
    await b.esperar('document.querySelector(\'[role="toolbar"][aria-label="Ações nos itens selecionados"]\')', { rotulo: 'barra de lote' })
    checar('selecionar todos mostra a barra com a contagem', (await b.texto()).includes(`${n0 + 1} itens selecionados`))
    const { data: antesAj } = await sb.from('propostas').select('valor_total').eq('id', idProposta).single()
    await b.clicar('button', { texto: 'Ajustar valor' })
    await b.esperar('document.querySelector("#ajuste_percentual")', { rotulo: 'diálogo de ajuste' })
    await b.preencher('#ajuste_percentual', '10')
    await b.esperar('document.querySelector(\'[data-testid="previa-ajuste"]\')', { rotulo: 'prévia do ajuste' })
    checar('a prévia mostra a soma antes e depois', /→/.test(await b.avaliar(`document.querySelector('[data-testid="previa-ajuste"]').innerText`)))
    await b.screenshot(`${SHOTS}/06f-ajuste-lote.png`)
    await b.clicar('button', { texto: 'Aplicar ajuste' })
    await b.esperar('!document.querySelector("#ajuste_percentual")', { rotulo: 'diálogo de ajuste fechar', ms: 25000 })
    const { data: depoisAj } = await sb.from('propostas').select('valor_total').eq('id', idProposta).single()
    const razao = Number(depoisAj?.valor_total) / Number(antesAj?.valor_total)
    checar('o ajuste de +10% sobe o valor da proposta em ~10% (centavos arredondados por item)',
      Math.abs(razao - 1.1) < 0.001, `antes=${antesAj?.valor_total} depois=${depoisAj?.valor_total}`)
    await b.esperar('!document.body.innerText.includes("Valor ajustado")', { rotulo: 'toast do ajuste sair', ms: 15000 })

    // Selecionar 2 e excluir em lote.
    await b.clicar(`input[aria-label="Selecionar o item ${esperadoPlanilha.primeiroNumero}"]`)
    await b.clicar(`input[aria-label="Selecionar o item ${esperadoPlanilha.primeiroNumero + 1}"]`)
    await b.esperar('document.body.innerText.includes("2 itens selecionados")', { rotulo: 'dois selecionados' })
    await b.clicar('button', { texto: 'Excluir selecionados' })
    await b.esperar('document.body.innerText.includes("Excluir 2 itens?")', { rotulo: 'confirmação do lote' })
    await b.clicar('[role="dialog"] button', { texto: 'Sim, excluir' })
    await b.esperar(`document.querySelectorAll('table[aria-label="Itens da proposta"] tbody tr').length === ${n0 - 1}`, {
      rotulo: 'itens saírem da tabela', ms: 25000,
    })
    checar('exclusão em lote pela tela tira os 2 selecionados', (await linhasNaTela()) === n0 - 1)
    await b.esperar('!document.body.innerText.includes("itens excluídos")', { rotulo: 'toast do lote sair', ms: 15000 })
  }

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

  // 9b. Formulário em modo leitura (pendência do 5.3). Com a proposta
  // enviada a tabela é só leitura, e o formulário é o único lugar onde
  // localização, vidros e observação aparecem.
  await b.clicar('button[role="tab"]', { texto: 'Itens' })
  await b.esperar('document.querySelector(\'button[aria-label^="Ver todos os campos do item"]\')', {
    rotulo: 'botão de ver os campos (modo leitura)', ms: 20000,
  })
  checar('fora de rascunho a tabela oferece ver todos os campos, sem lápis de edição',
    !(await b.avaliar('!!document.querySelector(\'button[aria-label^="Abrir formulário do item"]\')')))
  await b.clicar('button[aria-label^="Ver todos os campos do item"]')
  await b.esperar('document.querySelector("#item_localizacao")', { rotulo: 'formulário em leitura', ms: 20000 })
  const leitura = await b.avaliar(`JSON.stringify({
    desabilitado: document.querySelector('#item_localizacao').closest('fieldset')?.disabled === true,
    salvar: Array.from(document.querySelectorAll('[role="dialog"] button')).some(e => e.innerText.includes('Salvar item')),
    tipo: document.querySelector('#item_tipo').value,
  })`)
  checar('o formulário abre em leitura: campos desabilitados, sem "Salvar item", com os valores',
    /"desabilitado":true/.test(leitura) && /"salvar":false/.test(leitura) && /"tipo":"(Janela|Porta)"/.test(leitura), leitura)
  await b.clicar('[role="dialog"] button', { texto: 'Fechar' })
  await b.esperar('!document.querySelector("#item_localizacao")', { rotulo: 'formulário fechar', ms: 15000 })

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
  //
  // Esperar o toast sair não é enfeite: ele aparece no canto superior direito,
  // sobre a faixa do botão "Excluir" do header, e o clique daqui é evento de
  // mouse em coordenada — acerta o que está por cima. Com o next dev frio o
  // toast já tinha expirado quando o roteiro chegava aqui; com ele quente, não,
  // e o passo falhava sem nada errado na aplicação.
  await b.esperar('!document.body.innerText.includes("Anexo excluído")', {
    rotulo: 'toast do anexo sair da tela',
    ms: 15000,
  })
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

  // 13. Orçamentos: o HistoricoTab é compartilhado com Propostas, mas nunca
  //     tinha sido montado nesta rota num navegador — a camada runtime só prova
  //     que o rótulo "Histórico" sai no HTML do servidor.
  await b.ir(`${BASE}/orcamentos`)
  // A linha da tabela não é um link: o DataTable navega por onClick com
  // router.push no <tr>. Então o alvo é a linha, e o clique de quebra exercita
  // a navegação client-side, que nenhuma outra camada toca (o único
  // a[href^="/orcamentos/"] da tela é o botão "Novo orçamento").
  await b.esperar('document.querySelector("table tbody tr")', {
    rotulo: 'linha na listagem de orçamentos',
  })
  await b.clicar('table tbody tr')
  await b.esperar('/^\\/orcamentos\\/[0-9a-f-]{36}$/.test(location.pathname)', {
    rotulo: 'detalhe do orçamento', ms: 20000,
  })
  const detalheOrc = await b.texto()
  checar('detalhe do orçamento abre com as abas', detalheOrc.includes('Histórico'), await b.url())

  await b.clicar('button[role="tab"]', { texto: 'Histórico' })
  // Nenhum dos 28 orçamentos de gc-dev tem transição (a migration 013 é
  // aditiva, então o histórico deles nasceu vazio). O que este passo prova é
  // que o componente monta nesta rota, no estado vazio — a renderização das
  // entradas está provada na tela de Propostas, no passo 10, e no banco pela
  // camada de escrita.
  await b.esperar('document.body.innerText.includes("Nenhuma mudança de status registrada")', {
    rotulo: 'estado vazio do HistoricoTab',
  })
  const histOrc = await b.texto()
  checar(
    'aba Histórico do orçamento monta e diz "deste orçamento"',
    /histórico deste orçamento/i.test(histOrc),
    histOrc.match(/Nenhuma mudança[^.]{0,80}/)?.[0],
  )
  await b.screenshot(`${SHOTS}/11-orcamento-historico.png`)

  // 12. A tabela de itens no caso real: 12 linhas, e a medida em tela estreita.
  // Usa a proposta de supabase/seed_itens.sql, que é rascunho — a única
  // situação em que a tabela fica editável — e tem a contagem do PDF de
  // referência. `viewport()` existia no helper CDP desde o começo e nunca
  // havia sido chamado: responsividade nunca tinha sido medida no projeto.
  await b.ir(`${BASE}/propostas?busca=SEED-ITENS-001`)
  await b.esperar('document.querySelector("table tbody tr")', {
    rotulo: 'a proposta semeada na listagem',
  })
  await b.clicar('table tbody tr')
  await b.esperar(
    'location.pathname.startsWith("/propostas/") && location.pathname.split("/").length === 3',
    { rotulo: 'detalhe da proposta semeada', ms: 20000 },
  )
  await b.clicar('button[role="tab"]', { texto: 'Itens' })
  await b.esperar(
    'document.querySelectorAll(\'table[aria-label="Itens da proposta"] tbody tr\').length === 12',
    { rotulo: 'as 12 linhas da tabela', ms: 20000 },
  )
  const doze = await b.texto()
  // Atenção: `innerText` NÃO inclui o `value` de <input>. Na tabela editável
  // Tipo/Descrição são campos, então "Guarda-corpo" não aparece no texto —
  // tem de ser lido do próprio input. O rodapé, sim, é texto.
  const tiposNaTabela = await b.avaliar(`Array.from(
    document.querySelectorAll('table[aria-label="Itens da proposta"] input[aria-label="Tipo"]')
  ).map(i => i.value).join('|')`)
  checar('tabela renderiza os 12 itens do seed',
    doze.includes('12 itens') && tiposNaTabela.includes('Guarda-corpo'),
    `rodapé: ${doze.match(/12 itens[\s\S]{0,50}/)?.[0]} · tipos: ${tiposNaTabela}`)
  await b.screenshot(`${SHOTS}/12-itens-12-linhas.png`)

  // 12b. Tela × banco (bloco 5.8): área e valor total de cada linha, como
  // aparecem na tela, contra as colunas GENERATED do banco, formatadas pelos
  // MESMOS formatadores que a tela usa. A tela mostra previsão local enquanto
  // se digita; aqui, sem digitação, ela tem de mostrar exatamente o do banco.
  {
    const { formatCurrency } = await import('../src/lib/format.ts')
    const { formatArea } = await import('../src/lib/itens.ts')
    const sb = await clienteSupabase()
    const { data: doBanco } = await sb.from('propostas')
      .select('itens(numero, tipo, area_m2, valor_total)').eq('numero', 'SEED-ITENS-001').single()
    const naTela = await b.avaliar(`Array.from(document.querySelectorAll('table[aria-label="Itens da proposta"] tbody tr')).map(tr => {
      const td = tr.querySelectorAll('td');
      return { numero: tr.querySelector('input[aria-label="Número do item"]')?.value ?? '',
               tipo: tr.querySelector('input[aria-label="Tipo"]')?.value ?? '',
               area: td[10]?.innerText.trim(), total: td[12]?.innerText.trim() };
    })`)
    const norm = (t) => String(t ?? '').replace(/\s/g, ' ')
    const divergentes = []
    for (const it of doBanco?.itens ?? []) {
      const linha = naTela.find((l) => it.numero === null ? l.numero === '' && l.tipo === it.tipo : l.numero === String(it.numero))
      if (!linha) { divergentes.push(`item ${it.numero ?? it.tipo} não está na tela`); continue }
      const areaBanco = it.area_m2 && Number(it.area_m2) > 0 ? formatArea(Number(it.area_m2)) : '—'
      if (norm(linha.area) !== norm(areaBanco)) divergentes.push(`item ${it.numero}: área tela=${linha.area} banco=${areaBanco}`)
      if (norm(linha.total) !== norm(formatCurrency(Number(it.valor_total)))) divergentes.push(`item ${it.numero}: total tela=${linha.total} banco=${formatCurrency(Number(it.valor_total))}`)
    }
    checar(`área e valor total da tela batem com o banco nas ${doBanco?.itens?.length} linhas`,
      divergentes.length === 0 && (doBanco?.itens?.length ?? 0) === 12, divergentes.join(' | '))
  }

  // Largura de celular (390px, iPhone). `viewport()` existia no helper CDP
  // desde o começo e nunca havia sido chamado: responsividade nunca tinha sido
  // medida em nenhum bloco do projeto.
  //
  // O QUE ESTE BLOCO PROVA, e o que NÃO prova:
  //
  // A aplicação inteira não tem layout de celular — a Sidebar não colapsa e
  // come ~250px de 390, o que deixa o `main` com ~84px úteis. Isso é
  // PRÉ-EXISTENTE (medido abaixo numa tela sem tabela de itens) e o conserto é
  // do bloco 8.2 ("uso em campo (mobile)"), que mexe em Sidebar, Header e
  // todas as telas. Não é do 5.2, e fingir que é faria esta camada ficar
  // vermelha para sempre, que é como se treina gente a ignorar validação.
  //
  // Então aqui há duas coisas: o CONTRATO do 5.2, que é asserção de verdade, e
  // uma MEDIÇÃO do shell com guarda de não-regressão.
  await b.viewport(390, 844)

  const medida = await b.avaliar(`(() => {
    const t = document.querySelector('table[aria-label="Itens da proposta"]');
    const box = t ? t.closest('.overflow-x-auto') : null;
    return {
      paginaScroll: document.documentElement.scrollWidth,
      janela: window.innerWidth,
      tabela: t ? t.scrollWidth : 0,
      caixaVisivel: box ? box.clientWidth : 0,
      caixaScroll: box ? box.scrollWidth : 0,
    };
  })()`)

  // CONTRATO DO 5.2: a tabela de 12 colunas rola dentro do próprio container,
  // em vez de esticar a página. É o que o `overflow-x-auto` existe pra fazer.
  checar(
    'em 390px a tabela de itens rola dentro do próprio container',
    medida.caixaScroll > medida.caixaVisivel && medida.caixaVisivel > 0,
    JSON.stringify(medida),
  )
  await b.screenshot(`${SHOTS}/13-itens-390px.png`, { largura: 390, altura: 844 })

  // MEDIÇÃO DO SHELL: mesma largura, numa tela SEM tabela de itens. Se estoura
  // aqui, estoura em todo lugar, e a causa não é o 5.2.
  await b.ir(`${BASE}/propostas`)
  await b.esperar('document.querySelector("table tbody tr")', {
    rotulo: 'listagem em 390px',
  })
  const shell = await b.avaliar(`(() => ({
    paginaScroll: document.documentElement.scrollWidth,
    janela: window.innerWidth,
    sidebar: (() => { const n = document.querySelector('aside, nav'); return n ? Math.round(n.getBoundingClientRect().width) : 0 })(),
  }))()`)

  // Guarda de não-regressão, não asserção de correção: 552px foi o medido em
  // 2026-09-21 com a Sidebar fixa. Se alguém piorar, esta camada acusa; quando
  // o 8.2 consertar, o número cai e o limite deve cair junto.
  const SHELL_OVERFLOW_CONHECIDO = 560
  checar(
    `shell em 390px não piora além do conhecido (${SHELL_OVERFLOW_CONHECIDO}px)`,
    shell.paginaScroll <= SHELL_OVERFLOW_CONHECIDO,
    `PRÉ-EXISTENTE (bloco 8.2), medido: ${JSON.stringify(shell)}`,
  )
  console.log(
    `  nota  shell em 390px: ${shell.paginaScroll}px de scroll para ${shell.janela}px` +
      ` de janela, sidebar ${shell.sidebar}px — pendência do bloco 8.2`,
  )
  await b.screenshot(`${SHOTS}/14-shell-390px.png`, { largura: 390, altura: 844 })

  // Pendência do 6.1: /contratos nunca tinha sido medido em 390px. A mesma
  // guarda do shell: a listagem de contratos não pode estourar mais do que a
  // de propostas estoura hoje.
  await b.ir(`${BASE}/contratos`)
  await b.esperar('document.querySelector("table tbody tr")', { rotulo: '/contratos em 390px', ms: 25000 })
  const shellCt = await b.avaliar('({ paginaScroll: document.documentElement.scrollWidth, janela: window.innerWidth })')
  checar(
    `/contratos em 390px não estoura além do shell conhecido (${SHELL_OVERFLOW_CONHECIDO}px)`,
    shellCt.paginaScroll <= SHELL_OVERFLOW_CONHECIDO,
    `medido: ${JSON.stringify(shellCt)}`,
  )
  await b.screenshot(`${SHOTS}/14b-contratos-390px.png`, { largura: 390, altura: 844 })
  await b.viewport(1440, 900)

  // 15. Logs e auditoria (13.2): menu lateral, busca, filtro e o diff.
  //     A proposta desta rodada foi criada e excluída pela tela lá em cima,
  //     então o trigger deixou pelo menos "criar" e "excluir" com a referência.
  await b.clicar('nav a', { texto: 'Logs e auditoria' })
  await b.esperar('location.pathname === "/logs"', { rotulo: '/logs pelo menu', ms: 20000 })
  checar('item "Logs e auditoria" do menu lateral navega', (await b.url()).startsWith('/logs'), await b.url())

  await b.preencher('input[placeholder^="Buscar na mensagem"]', NUMERO)
  await b.esperar(`location.search.includes("busca=${NUMERO}")`, { rotulo: 'busca na URL (debounce)', ms: 10000 })
  await b.esperar('document.querySelector("table")', { rotulo: 'tabela de eventos', ms: 20000 })
  // Só as linhas da tabela de fora: o diff do <details> também tem <tr>.
  const linhasLog = await b.avaliar(
    'Array.from(document.querySelector("table").tBodies[0].rows).map((r) => r.innerText.replace(/\\s+/g, " "))',
  )
  checar(
    'busca pelo número acha os eventos da proposta desta rodada, todos com a referência',
    linhasLog.length >= 2 && linhasLog.every((l) => l.includes(NUMERO)),
    `${linhasLog.length} linha(s): ${linhasLog.slice(0, 3).join(' | ')}`,
  )
  checar(
    'a exclusão pela tela ficou registrada',
    linhasLog.some((l) => l.includes('Exclusão') && l.includes('registro excluído')),
    linhasLog.join(' | ').slice(0, 300),
  )
  await b.screenshot(`${SHOTS}/15-logs-busca.png`)

  await b.preencher('select[aria-label="resultado"]', 'erro')
  await b.esperar('location.search.includes("resultado=erro")', { rotulo: 'filtro de resultado na URL' })
  await b.esperar('document.body.innerText.includes("Nenhum evento encontrado com esses filtros")', {
    rotulo: 'filtro erro esvazia a busca',
  })
  checar('filtro "Erro" tira os eventos de sucesso', true)

  await b.ir(`${BASE}/logs?busca=SEED-VENCIDA-001`)
  await b.esperar('document.querySelector("details summary")', { rotulo: 'evento com diff' })
  await b.clicar('details summary')
  await b.esperar('document.querySelector("details[open]")', { rotulo: '<details> aberto' })
  const diff = await b.avaliar('document.querySelector("details[open]").innerText.replace(/\\s+/g, " ")')
  checar(
    'o <details> abre o diff campo a campo (antes → depois)',
    diff.includes('Antes') && diff.includes('Depois') && diff.includes('desconto') && diff.includes('5000'),
    diff,
  )
  await b.screenshot(`${SHOTS}/16-logs-diff.png`)
  await b.screenshot(`${SHOTS}/17-logs-390px.png`, { largura: 390, altura: 844 })
  await b.viewport(1440, 900)

  // 16. Listagem de contratos (6.1): menu, busca com debounce, filtros de
  //     status e período na URL. Os dados vêm de supabase/seed_contratos.sql.
  await b.clicar('nav a', { texto: 'Contratos' })
  await b.esperar('location.pathname === "/contratos"', { rotulo: '/contratos pelo menu', ms: 25000 })
  await b.esperar('document.querySelector("table tbody tr")', { rotulo: 'tabela de contratos', ms: 25000 })
  checar('item "Contratos" do menu abre a listagem', (await b.url()) === '/contratos', await b.url())

  const numerosContratos = () =>
    b.avaliar('Array.from(document.querySelectorAll("table tbody tr")).map((r) => r.cells[0].innerText.trim())')

  await b.preencher('input[aria-label="Buscar contratos"]', 'SEED-CT-00')
  await b.esperar('location.search.includes("busca=SEED-CT-00")', { rotulo: 'busca de contrato na URL (debounce)', ms: 10000 })
  await b.esperar('Array.from(document.querySelectorAll("table tbody tr")).every((r) => r.cells[0].innerText.startsWith("SEED-CT-"))', {
    rotulo: 'busca aplicada', ms: 20000,
  })
  const buscados = await numerosContratos()
  checar(
    'busca "SEED-CT-00" traz os 4 contratos do seed, com data mais recente primeiro e sem data no fim',
    JSON.stringify(buscados) === JSON.stringify(['SEED-CT-001', 'SEED-CT-002', 'SEED-CT-003', 'SEED-CT-004']),
    buscados.join(', '),
  )

  await b.preencher('select[aria-label="Status"]', 'rescindido')
  await b.esperar('location.search.includes("status=rescindido") && location.search.includes("busca=SEED-CT-00")', {
    rotulo: 'status na URL sem perder a busca',
  })
  await b.esperar('document.querySelectorAll("table tbody tr").length === 1', { rotulo: 'filtro de status aplicado', ms: 20000 })
  checar('filtro de status "Rescindido" deixa só SEED-CT-004', (await numerosContratos())[0] === 'SEED-CT-004')

  await b.preencher('select[aria-label="Status"]', '')
  // Cada select lê a URL atual pra montar a próxima: sem esperar, o segundo
  // push partiria da URL velha e traria o status de volta.
  await b.esperar('!location.search.includes("status=") && document.querySelectorAll("table tbody tr").length === 4', {
    rotulo: 'status limpo', ms: 20000,
  })
  await b.preencher('select[aria-label="Período"]', '90d')
  await b.esperar('location.search.includes("periodo=90d") && !location.search.includes("status=")', { rotulo: 'período na URL' })
  await b.esperar('document.querySelectorAll("table tbody tr").length === 1', { rotulo: 'filtro de período aplicado', ms: 20000 })
  checar('período "últimos 90 dias" deixa só o assinado há 10 dias (SEED-CT-001)', (await numerosContratos())[0] === 'SEED-CT-001')
  checar(
    'contrato com desconto mostra o valor final embaixo do total',
    /final/.test(await b.avaliar('document.querySelector("table tbody tr").innerText')),
  )
  await b.screenshot(`${SHOTS}/18-contratos-listagem.png`)

  // 17. Gerar contrato de proposta aprovada (6.2), sobre a PROP-2026-008 do
  //     seed (aprovada, desconto de R$ 8 mil, sem itens). Os dois contratos
  //     desta rodada levam o NUMERO e saem no finally.
  {
    const sb = await clienteSupabase()
    const { data: aprovada } = await sb.from('propostas')
      .select('id, valor_total, desconto, pct_sinal').eq('numero', 'PROP-2026-008').eq('status', 'aprovada').maybeSingle()
    checar('seed: PROP-2026-008 aprovada existe', Boolean(aprovada))
    if (aprovada) {
      await b.ir(`${BASE}/propostas/${aprovada.id}`)
      await b.esperar('Array.from(document.querySelectorAll("a")).some((a) => a.innerText.includes("Gerar contrato"))', {
        rotulo: 'botão Gerar contrato', ms: 25000,
      })
      await b.clicar('a', { texto: 'Gerar contrato' })
      await b.esperar('location.pathname.endsWith("/gerar-contrato") && document.querySelector("#desconto")', {
        rotulo: 'form de gerar contrato', ms: 25000,
      })
      const pre = await b.avaliar(`(() => ({
        numero: document.querySelector('#numero').value,
        valor: Number(document.querySelector('#valor_total').value),
        desconto: Number(document.querySelector('#desconto').value),
        sinal: Number(document.querySelector('#pct_sinal').value),
        obraTravada: document.querySelector('#obra_id').getAttribute('aria-readonly') === 'true',
      }))()`)
      checar(
        'o form nasce com valor, desconto e % da proposta, número em branco e obra travada',
        pre.numero === '' && pre.valor === Number(aprovada.valor_total) && pre.desconto === Number(aprovada.desconto) &&
          Math.abs(pre.sinal - Number(aprovada.pct_sinal) * 100) < 0.001 && pre.obraTravada,
        JSON.stringify(pre),
      )
      await b.screenshot(`${SHOTS}/19-gerar-contrato-form.png`)

      await b.preencher('#numero', `${NUMERO}-CT`)
      await b.clicar('button[type="submit"]')
      await b.esperar(`/^\\/contratos\\/[0-9a-f-]{36}$/.test(location.pathname) && document.body.innerText.includes(${JSON.stringify(`${NUMERO}-CT`)})`, {
        rotulo: 'detalhe do contrato gerado', ms: 25000,
      })
      checar('gerar pela tela leva ao detalhe do contrato novo (6.4), com o link da proposta de origem',
        (await b.texto()).includes('Gerado da proposta PROP-2026-008'))

      // Segunda vez: o form avisa, e o envio abre o diálogo de confirmação.
      await b.ir(`${BASE}/propostas/${aprovada.id}/gerar-contrato`)
      await b.esperar('document.querySelector("#numero") && document.querySelector("[role=alert]")', { rotulo: 'aviso de contrato existente', ms: 25000 })
      checar(
        'o form avisa que a proposta já gerou contrato, com o número',
        (await b.avaliar('document.querySelector("[role=alert]").innerText')).includes(`${NUMERO}-CT`),
      )
      // Página aberta por URL (e não por clique): o valor preenchido antes da
      // hidratação é apagado quando o react-hook-form monta. Repreenche até o
      // valor sobreviver meio segundo.
      for (let tentativa = 0; tentativa < 20; tentativa++) {
        await b.preencher('#numero', `${NUMERO}-CT2`)
        await new Promise((r) => setTimeout(r, 500))
        if ((await b.avaliar('document.querySelector("#numero").value')) === `${NUMERO}-CT2`) break
      }
      await b.clicar('button[type="submit"]')
      await b.esperar('document.body.innerText.includes("Gerar outro contrato desta proposta?")', { rotulo: 'diálogo de confirmação' })
      const antesDeConfirmar = (await sb.from('contratos').select('id').eq('numero', `${NUMERO}-CT2`)).data ?? []
      checar('sem confirmar, o segundo contrato ainda não existe', antesDeConfirmar.length === 0)
      await b.screenshot(`${SHOTS}/20-gerar-contrato-confirmar.png`)
      await b.clicar('button', { texto: 'Gerar mesmo assim' })
      await b.esperar(`/^\\/contratos\\/[0-9a-f-]{36}$/.test(location.pathname) && document.body.innerText.includes(${JSON.stringify(`${NUMERO}-CT2`)})`, {
        rotulo: 'segundo contrato gerado', ms: 25000,
      })
      const gerados = (await sb.from('contratos').select('numero, proposta_origem_id, desconto')
        .like('numero', `${NUMERO}-CT%`).order('numero')).data ?? []
      checar(
        'confirmado, os dois contratos existem, ligados à proposta e com o desconto dela',
        gerados.length === 2 && gerados.every((c) => c.proposta_origem_id === aprovada.id && Number(c.desconto) === Number(aprovada.desconto)),
        JSON.stringify(gerados),
      )
    }
  }

  // 18. Contrato avulso (6.3): o zod do form na tela — o que só roda no
  //     cliente. Número `${NUMERO}-AV`, apagado no finally.
  {
    await b.ir(`${BASE}/contratos`)
    await b.esperar('Array.from(document.querySelectorAll("a")).some((a) => a.innerText.includes("Novo contrato"))', {
      rotulo: 'botão Novo contrato', ms: 25000,
    })
    await b.clicar('a', { texto: 'Novo contrato' })
    await b.esperar('location.pathname === "/contratos/novo" && document.querySelector("#numero")', { rotulo: '/contratos/novo', ms: 25000 })
    checar('botão "Novo contrato" da listagem abre o form avulso', true)

    // Envio vazio: o zod barra no navegador, sem ida ao servidor.
    await b.clicar('button[type="submit"]')
    await b.esperar('document.body.innerText.includes("Número obrigatório")', { rotulo: 'erro de número' })
    const vazio = await b.texto()
    checar('envio vazio: "Número obrigatório" e "Selecione uma obra", e a tela não sai do form',
      vazio.includes('Selecione uma obra') && (await b.url()) === '/contratos/novo')

    const obraValor = await b.avaliar('Array.from(document.querySelector("#obra_id").options).map((o) => o.value).find((v) => v)')
    await b.preencher('#numero', `${NUMERO}-AV`)
    await b.preencher('#obra_id', obraValor)
    await b.preencher('#valor_total', '5000')
    await b.preencher('#desconto', '6000')
    await b.preencher('#pct_sinal', '60')
    await b.preencher('#pct_fd', '50')
    await b.clicar('button[type="submit"]')
    await b.esperar('document.body.innerText.includes("não pode passar de 100%")', { rotulo: 'erro de soma' })
    const errado = await b.texto()
    checar('desconto acima do valor e soma de 110% são barrados no form, com a mensagem de cada um',
      /Desconto não pode ser maior que o valor total/.test(errado) && /110%/.test(errado) && (await b.url()) === '/contratos/novo')
    checar('com o desconto acima do valor, a prévia do valor final mostra "—", e não um valor negativo',
      (await b.avaliar('document.querySelector("#valor_final_preview").value')) === '—')
    const antes63 = (await (await clienteSupabase()).from('contratos').select('id').eq('numero', `${NUMERO}-AV`)).data ?? []
    checar('nada foi gravado enquanto o form estava inválido', antes63.length === 0)
    await b.screenshot(`${SHOTS}/21-contrato-avulso-erros.png`)

    await b.preencher('#desconto', '500')
    await b.preencher('#pct_fd', '40')
    await b.preencher('#prazo_execucao', '60 dias')
    await b.clicar('button[type="submit"]')
    await b.esperar(`/^\\/contratos\\/[0-9a-f-]{36}$/.test(location.pathname) && document.body.innerText.includes(${JSON.stringify(`${NUMERO}-AV`)})`, {
      rotulo: 'detalhe do contrato avulso', ms: 25000,
    })
    const { data: criado } = await (await clienteSupabase()).from('contratos')
      .select('status, proposta_origem_id, valor_total, desconto, pct_sinal, pct_fd, prazo_execucao').eq('numero', `${NUMERO}-AV`).maybeSingle()
    checar('corrigido, cria o contrato ativo e sem origem, com os valores da tela (% em fração)',
      criado?.status === 'ativo' && criado?.proposta_origem_id === null && Number(criado?.valor_total) === 5000 &&
        Number(criado?.desconto) === 500 && Number(criado?.pct_sinal) === 0.6 && Number(criado?.pct_fd) === 0.4 &&
        criado?.prazo_execucao === '60 dias', JSON.stringify(criado ?? null))
  }

  // 19. Detalhe e edição do contrato (6.4), sobre o avulso do passo 18: a
  //     linha da listagem abre o detalhe, as abas trocam no cliente, e a
  //     edição reusa o zod do form do 6.3.
  {
    const sb = await clienteSupabase()
    const { data: av } = await sb.from('contratos').select('id').eq('numero', `${NUMERO}-AV`).maybeSingle()
    checar('o contrato avulso do passo 18 existe para o 6.4', Boolean(av))
    if (av) {
      await b.ir(`${BASE}/contratos?busca=${encodeURIComponent(`${NUMERO}-AV`)}`)
      await b.esperar(`Array.from(document.querySelectorAll("table tbody tr")).some((tr) => tr.innerText.includes(${JSON.stringify(`${NUMERO}-AV`)}))`, {
        rotulo: 'contrato avulso na listagem', ms: 25000,
      })
      await b.clicar('table tbody tr td', { texto: `${NUMERO}-AV` })
      await b.esperar(`location.pathname === ${JSON.stringify(`/contratos/${av.id}`)}`, { rotulo: 'detalhe pelo clique na linha', ms: 25000 })
      checar('clicar na linha da listagem abre o detalhe do contrato', (await b.url()) === `/contratos/${av.id}`)

      const abas = await b.avaliar('Array.from(document.querySelectorAll("[role=tab]")).map((t) => t.innerText.trim())')
      checar('o detalhe tem as abas Detalhes, Itens, Anexos e Financeiro',
        ['Detalhes', 'Itens', 'Anexos', 'Financeiro'].every((n) => abas.some((a) => a.startsWith(n))), JSON.stringify(abas))
      checar('contrato avulso: sem link de proposta de origem, "Contrato avulso" nos detalhes',
        !(await b.texto()).includes('Gerado da proposta') && (await b.texto()).includes('Contrato avulso'))

      await b.clicar('[role=tab]', { texto: 'Financeiro' })
      await b.esperar('Array.from(document.querySelectorAll("[role=tabpanel]")).some((p) => !p.hidden && p.innerText.includes("Sprint 12"))', { rotulo: 'aba Financeiro' })
      checar('a aba Financeiro mostra o placeholder do Sprint 12', true)
      await b.clicar('[role=tab]', { texto: 'Itens' })
      // Vazia e editável, a aba mostra "Nenhum item ainda."; a frase "Este
      // contrato não tem itens." é da versão somente-leitura.
      await b.esperar('Array.from(document.querySelectorAll("[role=tabpanel]")).some((p) => !p.hidden && p.innerText.includes("Nenhum item ainda."))', { rotulo: 'aba Itens' })
      checar('a aba Itens do contrato abre vazia e editável',
        await b.avaliar('Array.from(document.querySelectorAll("[role=tabpanel]")).some((p) => !p.hidden && p.innerText.includes("Adicionar item"))'))
      await b.screenshot(`${SHOTS}/22-contrato-detalhe.png`)

      await b.clicar('a', { texto: 'Editar' })
      await b.esperar(`location.pathname === ${JSON.stringify(`/contratos/${av.id}/editar`)} && document.querySelector("#descricao")`, { rotulo: 'form de edição', ms: 25000 })
      const pre = await b.avaliar(`(() => ({
        numero: document.querySelector('#numero').value,
        valor: Number(document.querySelector('#valor_total').value),
        sinal: Number(document.querySelector('#pct_sinal').value),
        prazo: document.querySelector('#prazo_execucao').value,
      }))()`)
      checar('a edição abre com os valores do contrato (% de volta a 0..100)',
        pre.numero === `${NUMERO}-AV` && pre.valor === 5000 && pre.sinal === 60 && pre.prazo === '60 dias', JSON.stringify(pre))

      await b.preencher('#pct_fd', '50')
      await b.clicar('button[type="submit"]')
      await b.esperar('document.body.innerText.includes("não pode passar de 100%")', { rotulo: 'erro de soma na edição' })
      checar('na edição, a soma de 110% é barrada no form sem sair da tela',
        (await b.url()) === `/contratos/${av.id}/editar`)

      await b.preencher('#pct_fd', '40')
      await b.preencher('#descricao', 'Editado pela camada navegador')
      await b.clicar('button[type="submit"]')
      await b.esperar(`location.pathname === ${JSON.stringify(`/contratos/${av.id}`)} && document.body.innerText.includes("Editado pela camada navegador")`, {
        rotulo: 'detalhe depois de salvar', ms: 25000,
      })
      const { data: editado } = await sb.from('contratos').select('descricao, pct_fd, status').eq('id', av.id).maybeSingle()
      checar('salvar volta ao detalhe com a descrição nova, gravada no banco',
        editado?.descricao === 'Editado pela camada navegador' && Number(editado?.pct_fd) === 0.4 && editado?.status === 'ativo',
        JSON.stringify(editado ?? null))
    }
  }

  // 20. Mudança de status e rescisão (6.5), sobre o mesmo avulso do passo 18:
  //     o select de motivo só aparece em "Rescindido", o zod barra motivo
  //     vazio e "Outro" sem detalhamento, e a aba Histórico mostra a entrada.
  {
    const sb = await clienteSupabase()
    const { data: av } = await sb.from('contratos').select('id').eq('numero', `${NUMERO}-AV`).maybeSingle()
    if (av) {
      await b.ir(`${BASE}/contratos/${av.id}`)
      await b.esperar('Array.from(document.querySelectorAll("button")).some((x) => x.innerText.includes("Mudar status"))', {
        rotulo: 'botão Mudar status', ms: 25000,
      })
      await b.clicar('button', { texto: 'Mudar status' })
      await b.esperar('document.querySelector("#novo_status")', { rotulo: 'diálogo de status' })
      const destinos = await b.avaliar('Array.from(document.querySelector("#novo_status").options).map((o) => o.value)')
      checar('o diálogo oferece só suspenso, concluído e rescindido a partir de ativo',
        JSON.stringify(destinos) === JSON.stringify(['suspenso', 'concluido', 'rescindido']), JSON.stringify(destinos))
      checar('sem escolher "Rescindido", o select de motivo não aparece',
        !(await b.avaliar('Boolean(document.querySelector("#motivo_rescisao"))')))

      await b.preencher('#novo_status', 'rescindido')
      // No next dev, o reset do diálogo ao abrir às vezes chega depois do
      // primeiro change e devolve o select para "suspenso" (fechamento da
      // sprint 7: falhou na rodada completa e passou isolado). Se voltou,
      // escolhe de novo; a asserção de baixo continua a mesma.
      for (let i = 0; i < 3 && !(await b.avaliar('Boolean(document.querySelector("#motivo_rescisao"))')); i++) {
        await new Promise((r) => setTimeout(r, 1000))
        if ((await b.avaliar('document.querySelector("#novo_status").value')) !== 'rescindido') {
          await b.preencher('#novo_status', 'rescindido')
        }
      }
      await b.esperar('document.querySelector("#motivo_rescisao")', { rotulo: 'select de motivo' })
      await b.clicar('button[type="submit"]', { texto: 'Salvar mudança' })
      await b.esperar('document.body.innerText.includes("Motivo é obrigatório")', { rotulo: 'erro de motivo' })
      await b.preencher('#motivo_rescisao', 'outro')
      await b.clicar('button[type="submit"]', { texto: 'Salvar mudança' })
      await b.esperar('document.body.innerText.includes("Descreva o motivo quando escolher")', { rotulo: 'erro de detalhamento' })
      const aindaAtivo = (await sb.from('contratos').select('status').eq('id', av.id).maybeSingle()).data
      checar('motivo vazio e "Outro" sem detalhamento são barrados no diálogo, sem gravar', aindaAtivo?.status === 'ativo')
      await b.screenshot(`${SHOTS}/23-contrato-rescisao-erros.png`)

      await b.preencher('#detalhe_rescisao', 'Cliente desistiu da obra')
      await b.clicar('button[type="submit"]', { texto: 'Salvar mudança' })
      await b.esperar('!document.querySelector("#novo_status") && Array.from(document.querySelectorAll("h2")).some((h) => h.innerText.includes("Rescisão"))', {
        rotulo: 'detalhe rescindido', ms: 25000,
      })
      const r = (await sb.from('contratos').select('status, motivo_rescisao, detalhe_rescisao, historico').eq('id', av.id).maybeSingle()).data
      checar('salvo, o contrato fica rescindido com motivo e detalhamento, e o histórico ganha a entrada',
        r?.status === 'rescindido' && r?.motivo_rescisao === 'outro' && r?.detalhe_rescisao === 'Cliente desistiu da obra' &&
          r?.historico?.length === 1, JSON.stringify(r ?? null))
      checar('rescindido: o botão Mudar status some',
        !(await b.avaliar('Array.from(document.querySelectorAll("button")).some((x) => x.innerText.includes("Mudar status"))')))

      await b.clicar('[role=tab]', { texto: 'Histórico' })
      await b.esperar('Array.from(document.querySelectorAll("[role=tabpanel]")).some((p) => !p.hidden && p.innerText.includes("Motivo da rescisão"))', { rotulo: 'aba Histórico' })
      checar('a aba Histórico mostra a transição com o motivo e o detalhamento',
        await b.avaliar('Array.from(document.querySelectorAll("[role=tabpanel]")).some((p) => !p.hidden && p.innerText.includes("Cliente desistiu da obra"))'))
      await b.screenshot(`${SHOTS}/24-contrato-historico.png`)
    }
  }

  // 21. Pendência do 6.2: "Copiar itens" pela tela. A proposta aprovada do
  //     seed não tem itens, então este passo monta uma pelo cliente Supabase
  //     (`${NUMERO}-CI`, com 2 itens), e a limpeza do finally a apaga.
  {
    const sb = await clienteSupabase()
    const { data: { user } } = await sb.auth.getUser()
    const { data: eu } = await sb.from('profiles').select('empresa_id').eq('id', user.id).maybeSingle()
    const { data: obraCi } = await sb.from('obras').select('id').order('codigo_obra').limit(1).maybeSingle()
    const hoje = new Date().toISOString().slice(0, 10)
    const { data: pci, error: epci } = await sb.from('propostas').insert({
      empresa_id: eu.empresa_id, obra_id: obraCi.id, numero: `${NUMERO}-CI`, status: 'aprovada',
      data_emissao: hoje, data_envio: hoje, data_decisao: hoje, valor_total: 0, desconto: 0,
      observacao: 'camada navegador: copiar itens',
    }).select('id').single()
    checar('proposta aprovada com itens montada para o "Copiar itens"', !epci, epci?.message)
    if (pci) {
      const item = (numero, valor_unit) => ({
        empresa_id: eu.empresa_id, obra_id: obraCi.id, proposta_id: pci.id, numero, tipo: 'Janela',
        descricao: `item ${numero} do copiar itens`, quantidade: 2, unidade: 'QTD', valor_unit,
      })
      const { error: eit } = await sb.from('itens').insert([item(1, 300), item(2, 200)])
      checar('os 2 itens da proposta foram inseridos', !eit, eit?.message)

      await b.ir(`${BASE}/propostas/${pci.id}/gerar-contrato`)
      // O register do react-hook-form só põe o valor no input ao hidratar; antes
      // disso o HTML do servidor tem o input vazio, e Number('') daria 0.
      await b.esperar('document.querySelector("input[name=copiar_itens]") && document.querySelector("#valor_total")?.value !== ""', { rotulo: 'form de gerar com itens', ms: 25000 })
      const pre = await b.avaliar(`(() => ({
        marcada: document.querySelector('input[name=copiar_itens]').checked,
        valor: Number(document.querySelector('#valor_total').value),
        travado: document.querySelector('#valor_total').readOnly,
        dica: document.body.innerText.includes('Soma dos 2 itens'),
      }))()`)
      checar('com itens, "Copiar itens" nasce marcada e o valor total vem travado na soma (1.000)',
        pre.marcada && pre.valor === 1000 && pre.travado && pre.dica, JSON.stringify(pre))

      await b.clicar('input[name=copiar_itens]')
      await b.esperar('!document.querySelector("#valor_total").readOnly', { rotulo: 'valor destravado' })
      checar('desmarcada, o valor total volta a ser editável', true)
      await b.clicar('input[name=copiar_itens]')
      await b.esperar('document.querySelector("#valor_total").readOnly', { rotulo: 'valor travado de novo' })
      await b.screenshot(`${SHOTS}/25-gerar-copiando-itens.png`)

      for (let tentativa = 0; tentativa < 20; tentativa++) {
        await b.preencher('#numero', `${NUMERO}-CI1`)
        await new Promise((r) => setTimeout(r, 500))
        if ((await b.avaliar('document.querySelector("#numero").value')) === `${NUMERO}-CI1`) break
      }
      await b.clicar('button[type="submit"]')
      await b.esperar(`/^\\/contratos\\/[0-9a-f-]{36}$/.test(location.pathname) && document.body.innerText.includes(${JSON.stringify(`${NUMERO}-CI1`)})`, {
        rotulo: 'detalhe do contrato com itens', ms: 25000,
      })
      const { data: ctci } = await sb.from('contratos').select('id, valor_total, itens(valor_total)').eq('numero', `${NUMERO}-CI1`).maybeSingle()
      checar('gerado copiando, o contrato tem os 2 itens e o valor total é a soma deles',
        ctci?.itens?.length === 2 && Number(ctci?.valor_total) === 1000, JSON.stringify(ctci ?? null))
      checar('a aba do detalhe mostra "Itens (2)"',
        await b.avaliar('Array.from(document.querySelectorAll("[role=tab]")).some((t) => t.innerText.trim() === "Itens (2)")'))
    }
  }

  // 23. Execução por obra (7.2), sobre o SEED-CT-EXEC. Antes do passo 22,
  //     que troca a sessão para a do comercial (e comercial não entra aqui).
  //     Não clica em "Criar execução": criaria execução para todo item de
  //     contrato da obra — a camada escrita cobre a ação numa obra isolada.
  {
    const sb = await clienteSupabase()
    const { data: ctExe } = await sb.from('contratos').select('obra_id').eq('numero', 'SEED-CT-EXEC').maybeSingle()
    checar('seed: SEED-CT-EXEC existe (supabase/seed_execucao.sql)', Boolean(ctExe))
    if (ctExe) {
      await b.ir(`${BASE}/execucao`)
      await b.esperar('document.querySelector("select[aria-label=Obra]")', { rotulo: 'seletor de obra', ms: 25000 })
      checar('sem obra, a tela pede a obra', (await b.texto()).includes('Escolha uma obra'))
      await b.preencher('select[aria-label=Obra]', ctExe.obra_id)
      await b.esperar(`location.search.includes(${JSON.stringify(`obra=${ctExe.obra_id}`)}) && document.querySelector("table tbody tr")`, {
        rotulo: 'execução da obra', ms: 25000,
      })
      const topo = await b.avaliar(`Array.from(document.querySelectorAll('[aria-label="Progresso da obra"] > div')).map((d) => d.innerText.replace(/\s+/g, ' ').trim())`)
      checar('o totalizador mostra as 4 etapas com percentual', topo.length === 4 && topo.every((t) => /%$/.test(t)), JSON.stringify(topo))
      await b.screenshot(`${SHOTS}/27-execucao-obra.png`)

      await b.preencher('select[aria-label=Etapa]', 'ent')
      await b.esperar('location.search.includes("etapa=ent")', { rotulo: 'filtro de etapa na URL' })
      await b.esperar('!document.body.innerText.includes("Guarda-corpo") || document.body.innerText.includes("Nenhuma execução")', { rotulo: 'filtro aplicado' })
      const emEntrega = await b.texto()
      checar('filtro "Em entrega" deixa a Porta pivotante e tira o Guarda-corpo',
        emEntrega.includes('Porta pivotante') && !emEntrega.includes('Box de vidro'))

      await b.ir(`${BASE}/execucao?obra=${ctExe.obra_id}&ordem=atraso`)
      await b.esperar('document.querySelector("table tbody tr")', { rotulo: 'ordem por atraso', ms: 25000 })
      const ordem = await b.avaliar(`Array.from(document.querySelectorAll('table tbody tr')).map((tr) => tr.querySelector('td p + p')?.innerText.trim())`)
      // 7.5: o Guarda-corpo tem a previsão da fabricação vencida (seed), e
      // previsão vencida vem antes de tudo na ordem por atraso.
      const seed = ['Guarda-corpo', 'Box de vidro', 'Porta pivotante', 'Janela de correr']
      const posicoes = seed.map((d) => ordem.indexOf(d))
      checar('ordem por atraso: previsão vencida, zerada, entrega pela metade e concluída, nessa ordem',
        posicoes.every((p) => p >= 0) && posicoes.every((p, i) => i === 0 || p > posicoes[i - 1]), JSON.stringify(ordem))

      await b.preencher('input[aria-label="Buscar itens"]', 'pivotante')
      await b.esperar('location.search.includes("busca=pivotante")', { rotulo: 'busca com debounce na URL', ms: 10000 })
      await b.esperar('document.querySelectorAll("table tbody tr").length === 1', { rotulo: 'uma linha na busca' })
      checar('a busca pela descrição chega à URL (debounce) e deixa uma linha', true)
    }
  }

  // 24. Painel de apontamento (7.3), sobre o "Box de vidro" do seed (4
  //     unidades, zerado). O que só roda no cliente: o máximo que muda ao
  //     vivo, a mensagem da cascata, o "Concluir etapa" e a troca só da linha.
  //     O seed é devolvido ao estado zerado no fim do passo.
  {
    const sb = await clienteSupabase()
    const { data: ctExe } = await sb.from('contratos').select('id, obra_id').eq('numero', 'SEED-CT-EXEC').maybeSingle()
    const { data: box } = ctExe
      ? await sb.from('execucao').select('id, item:itens!inner(descricao, contrato_id)').eq('item.contrato_id', ctExe.id).eq('item.descricao', 'Box de vidro').maybeSingle()
      : { data: null }
    checar('seed: execução "Box de vidro" do SEED-CT-EXEC existe', Boolean(box))
    if (box) {
      try {
        const url = `${BASE}/execucao?obra=${ctExe.obra_id}`
        await b.ir(url)
        await b.esperar('document.querySelector(\'button[aria-label="Apontar Box de vidro"]\')', { rotulo: 'botão Apontar', ms: 25000 })
        await b.clicar('button[aria-label="Apontar Box de vidro"]')
        await b.esperar('document.querySelector("#qtd-fab")', { rotulo: 'painel de apontamento' })
        const etapas = await b.avaliar('Array.from(document.querySelectorAll("[data-etapa]")).map((li) => li.dataset.etapa)')
        checar('o painel mostra as 4 etapas em sequência', JSON.stringify(etapas) === JSON.stringify(['fab', 'ent', 'inst', 'med']), JSON.stringify(etapas))
        checar('com nada fabricado, a entrega nasce com máximo 0 no input',
          (await b.avaliar('document.querySelector("#qtd-ent").max')) === '0')

        await b.preencher('#qtd-ent', '1')
        await b.esperar('document.querySelector("#erro-ent")', { rotulo: 'mensagem da cascata' })
        checar('entregar sem fabricar mostra a mensagem e desabilita o salvar',
          (await b.avaliar('document.querySelector("#erro-ent").innerText')).includes('nenhuma unidade foi fabricada') &&
            (await b.avaliar('Array.from(document.querySelectorAll("button")).find((x) => x.innerText.includes("Salvar apontamento")).disabled')))
        await b.screenshot(`${SHOTS}/28-apontamento-bloqueio.png`)

        await b.clicar('[data-etapa="fab"] button', { texto: 'Concluir etapa' })
        await b.esperar('document.querySelector("#qtd-fab").value === "4"', { rotulo: 'concluir etapa preenche o máximo' })
        checar('"Concluir etapa" preenche a fabricação com o total (4), e a entrega passa a aceitar até 4',
          (await b.avaliar('document.querySelector("#qtd-ent").max')) === '4' && !(await b.avaliar('Boolean(document.querySelector("#erro-ent"))')))
        await b.preencher('#qtd-ent', '2')
        await b.preencher('#resp-ent', 'Validação navegador')
        await b.clicar('button', { texto: 'Salvar apontamento' })
        await b.esperar('!document.querySelector("#qtd-fab")', { rotulo: 'painel fecha depois de salvar', ms: 20000 })
        await b.esperar(`(() => { const tr = document.querySelector('tr[data-execucao="${box.id}"]'); return tr && tr.innerText.includes('4 / 4') && tr.innerText.includes('2 / 4') })()`, {
          rotulo: 'linha atualizada', ms: 20000,
        })
        checar('salvo, a linha mostra 4 / 4 e 2 / 4 sem sair da tela', (await b.url()).startsWith('/execucao'))
        const { data: gravado } = await sb.from('execucao').select('fab_qtd, ent_qtd, ent_responsavel, fab_data_fim').eq('id', box.id).maybeSingle()
        checar('no banco: fabricação 4, entrega 2, responsável gravado e fim da fabricação preenchido pelo trigger',
          Number(gravado?.fab_qtd) === 4 && Number(gravado?.ent_qtd) === 2 && gravado?.ent_responsavel === 'Validação navegador' && Boolean(gravado?.fab_data_fim),
          JSON.stringify(gravado ?? null))

        await b.clicar('button[aria-label="Apontar Box de vidro"]')
        await b.esperar('document.querySelector("#qtd-fab")', { rotulo: 'painel reaberto' })
        checar('reaberto, o painel mostra as datas que o trigger preencheu',
          (await b.avaliar('document.querySelector(\'[data-etapa="fab"]\').innerText')).match(/Fim \d{2}\/\d{2}\/\d{4}/) !== null)
        await b.screenshot(`${SHOTS}/29-apontamento-datas.png`)
        await b.clicar('button', { texto: 'Cancelar' })
      } finally {
        // Devolve o seed: execução zerada, sem responsável e sem datas.
        await sb.from('execucao').update({
          med_qtd: 0, inst_qtd: 0, ent_qtd: 0, fab_qtd: 0, ent_responsavel: null,
        }).eq('id', box.id)
        await sb.from('execucao').update({
          fab_data_inicio: null, fab_data_atualizacao: null, fab_data_fim: null,
          ent_data_inicio: null, ent_data_atualizacao: null, ent_data_fim: null,
        }).eq('id', box.id)
      }
    }
  }

  // 25. Contatos do bot (automação, Fase 7), antes do passo 22 porque ele
  //     troca a sessão para comercial. Aba em Configurações, formulário em
  //     modal com o zod do cliente, toast e exclusão pelo ConfirmDialog.
  {
    const CODIGO_NAV = String(8_000_000_000 + (Date.now() % 1_000_000_000))
    await b.ir(`${BASE}/configuracoes`)
    await b.clicar('a', { texto: 'Contatos do bot' })
    await b.esperar('location.pathname === "/configuracoes/contatos"', { rotulo: '/configuracoes/contatos' })
    await b.esperar('document.body.innerText.includes("Novo contato")', { rotulo: 'botão Novo contato' })
    checar('aba "Contatos do bot" navega a partir de Configurações', (await b.url()) === '/configuracoes/contatos')

    await b.clicar('button', { texto: 'Novo contato' })
    await b.esperar('document.querySelector("#telegram_chat_id")', { rotulo: 'modal do contato' })
    await b.clicar('[role="dialog"] button', { texto: 'Salvar' })
    await b.esperar('document.body.innerText.includes("Informe o código que o bot enviou")', { rotulo: 'erro do zod', ms: 5000 })
    checar('zod do cliente barra o contato sem código e sem obra',
      (await b.texto()).includes('Escolha a obra'))
    await b.screenshot(`${SHOTS}/25-contato-invalido.png`)

    const obraCt = await b.avaliar(`(() => {
      const o = [...document.querySelectorAll('#obra_id option')].find((x) => x.value)
      return o ? o.value : ''
    })()`)
    await b.preencher('#telegram_chat_id', CODIGO_NAV)
    await b.preencher('#obra_id', obraCt)
    await b.preencher('#nome', `${NUMERO} contato`)
    await b.clicar('[role="dialog"] button', { texto: 'Salvar' })
    await b.esperar('document.body.innerText.includes("Contato cadastrado")', { rotulo: 'toast de contato cadastrado' })
    await b.esperar(`document.body.innerText.includes(${JSON.stringify(CODIGO_NAV)})`, { rotulo: 'contato na tabela' })
    checar('contato salvo pela tela aparece na tabela com o código', (await b.texto()).includes(`${NUMERO} contato`))
    await b.screenshot(`${SHOTS}/25b-contato-na-tabela.png`)

    await b.clicar(`button[aria-label="Excluir ${NUMERO} contato"]`)
    await b.esperar('document.body.innerText.includes("deixa de poder mandar propostas")', { rotulo: 'ConfirmDialog do contato' })
    await b.clicar('[role="dialog"] button', { texto: 'Excluir' })
    await b.esperar(`!document.body.innerText.includes(${JSON.stringify(CODIGO_NAV)})`, { rotulo: 'contato sumir', ms: 15000 })
    checar('contato excluído pela tela some da tabela', !(await b.texto()).includes(`${NUMERO} contato`))
  }

  // 26. Várias execuções por item (7.4), sobre a Fachada do seed (10 un, Torre
  //     A 6 e Torre B 4). Só o que roda no cliente: o resumo do item no painel
  //     e o limite da quantidade. Não grava nada.
  {
    const sb = await clienteSupabase()
    const { data: ctExe } = await sb.from('contratos').select('id, obra_id').eq('numero', 'SEED-CT-EXEC').maybeSingle()
    const { data: torreA } = ctExe
      ? await sb.from('execucao').select('id, item:itens!inner(contrato_id, descricao)')
        .eq('item.contrato_id', ctExe.id).eq('item.descricao', 'Fachada de vidro').eq('sequencial', 1).maybeSingle()
      : { data: null }
    checar('seed: Fachada com a execução "Torre A"', Boolean(torreA))
    if (torreA) {
      await b.ir(`${BASE}/execucao?obra=${ctExe.obra_id}`)
      await b.esperar(`document.querySelector('tr[data-execucao="${torreA.id}"]')`, { rotulo: 'linha da Torre A', ms: 25000 })
      await b.clicar(`tr[data-execucao="${torreA.id}"] button`)
      await b.esperar('document.querySelector("#quantidade-execucao")', { rotulo: 'painel da Torre A' })
      checar('o painel diz quanto o item tem e quanto as outras execuções somam',
        (await b.avaliar('document.querySelector("[data-testid=resumo-item]").innerText')).includes('em 2 execuções; as outras somam 4'))
      await b.preencher('#quantidade-execucao', '7')
      await b.esperar('document.querySelector("#erro-quantidade")', { rotulo: 'erro da quantidade' })
      checar('aumentar a Torre A para 7 é barrado: só cabem 6, e o Salvar desabilita',
        (await b.avaliar('document.querySelector("#erro-quantidade").innerText')).includes('Só cabem 6') &&
          (await b.avaliar('Array.from(document.querySelectorAll("button")).find((x) => x.innerText.includes("Salvar apontamento")).disabled')))
      await b.clicar('button', { texto: 'Nova execução deste item' })
      await b.esperar('document.querySelector("#nova-quantidade")', { rotulo: 'form de nova execução' })
      checar('com o item todo distribuído, "Criar execução" fica desabilitado e a tela explica',
        (await b.texto()).includes('já está todo distribuído') &&
          (await b.avaliar('Array.from(document.querySelectorAll("button")).find((x) => x.innerText.trim() === "Criar execução").disabled')))
      await b.screenshot(`${SHOTS}/30-varias-execucoes.png`)
      await b.clicar('button', { texto: 'Cancelar' })
    }
  }

  // 27. Previsões e atrasos (7.5). Previsão futura depende do dia, então não
  //     mora no seed: o passo põe uma na entrega da Porta pivotante (hoje + 3)
  //     e a tira no fim. O Guarda-corpo já vem do seed com a fabricação vencida.
  {
    const sb = await clienteSupabase()
    const { data: ctExe } = await sb.from('contratos').select('id, obra_id').eq('numero', 'SEED-CT-EXEC').maybeSingle()
    const { data: porta } = ctExe
      ? await sb.from('execucao').select('id, item:itens!inner(contrato_id, descricao)')
        .eq('item.contrato_id', ctExe.id).eq('item.descricao', 'Porta pivotante').maybeSingle()
      : { data: null }
    checar('seed: execução "Porta pivotante" existe', Boolean(porta))
    if (porta) {
      const daqui3 = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
      try {
        await sb.from('execucao').update({ ent_previsao_fim: daqui3 }).eq('id', porta.id)
        await b.ir(`${BASE}/execucao?obra=${ctExe.obra_id}`)
        await b.esperar('document.querySelector("[aria-label=\\"Próximos vencimentos\\"]")', { rotulo: 'painel de vencimentos', ms: 25000 })
        const painel = await b.avaliar('document.querySelector("[aria-label=\\"Próximos vencimentos\\"]").innerText')
        checar('o painel lista a entrega da Porta pivotante "em 3 dias" e conta o atraso do seed',
          painel.includes('Porta pivotante') && painel.includes('Entrega') && painel.includes('em 3 dias') && /execuç(ão|ões) atrasada/.test(painel),
          painel.replace(/\s+/g, ' ').slice(0, 200))
        const selo = await b.avaliar(`Array.from(document.querySelectorAll('table tbody tr')).filter((tr) => tr.innerText.includes('Atrasada')).map((tr) => tr.querySelector('td p + p')?.innerText.trim())`)
        checar('o selo "Atrasada" aparece no Guarda-corpo e não na Janela (concluída, com previsão vencida)',
          selo.includes('Guarda-corpo') && !selo.includes('Janela de correr'), JSON.stringify(selo))
        await b.screenshot(`${SHOTS}/31-vencimentos.png`)

        // Pendência de 7.2, 7.3 e 7.5: /execucao nunca tinha sido medida em
        // 390px. A mesma guarda do shell de /contratos, a tabela de seis colunas
        // rolando no próprio container e o painel de apontamento cabendo na
        // janela. Medição, não conferência estética.
        await b.viewport(390, 844)
        await b.ir(`${BASE}/execucao?obra=${ctExe.obra_id}`)
        await b.esperar('document.querySelector("[aria-label=\\"Próximos vencimentos\\"]") && document.querySelector("table tbody tr")', { rotulo: '/execucao em 390px', ms: 25000 })
        const exe390 = await b.avaliar(`(() => {
          const caixa = document.querySelector('table').closest('.overflow-x-auto');
          return {
            paginaScroll: document.documentElement.scrollWidth, janela: window.innerWidth,
            tabelaRolaDentro: Boolean(caixa) && caixa.scrollWidth > caixa.clientWidth,
          };
        })()`)
        checar(`/execucao em 390px não estoura além do shell conhecido (${SHELL_OVERFLOW_CONHECIDO}px), e a tabela rola no próprio container`,
          exe390.paginaScroll <= SHELL_OVERFLOW_CONHECIDO && exe390.tabelaRolaDentro, `medido: ${JSON.stringify(exe390)}`)
        await b.screenshot(`${SHOTS}/31b-execucao-390px.png`, { largura: 390, altura: 844 })
        await b.clicar('button[aria-label="Apontar Porta pivotante"]')
        await b.esperar('document.querySelector("#qtd-fab")', { rotulo: 'painel em 390px' })
        const painel390 = await b.avaliar(`(() => {
          const r = document.querySelector('[role=dialog]').getBoundingClientRect();
          return { esquerda: Math.round(r.left), direita: Math.round(r.right), janela: window.innerWidth };
        })()`)
        checar('em 390px o painel de apontamento cabe na janela, sem cortar nas laterais',
          painel390.esquerda >= 0 && painel390.direita <= painel390.janela, `medido: ${JSON.stringify(painel390)}`)
        await b.screenshot(`${SHOTS}/31c-apontamento-390px.png`, { largura: 390, altura: 844 })
        await b.viewport(1440, 900)
        await b.ir(`${BASE}/execucao?obra=${ctExe.obra_id}`)
        await b.esperar('document.querySelector("select[aria-label=Prazo]") && document.querySelector("table tbody tr")', { rotulo: '/execucao de volta em 1440px', ms: 25000 })

        await b.preencher('select[aria-label=Prazo]', '1')
        await b.esperar('location.search.includes("atrasados=1")', { rotulo: 'filtro só atrasados na URL' })
        // O painel de vencimentos não é filtrado (é da obra inteira): a espera olha só a tabela.
        await b.esperar(`document.querySelectorAll('table tbody tr').length > 0 && !Array.from(document.querySelectorAll('table tbody tr')).some((tr) => tr.innerText.includes('Porta pivotante'))`, { rotulo: 'filtro aplicado', ms: 15000 })
        const linhasAtraso = await b.avaliar(`Array.from(document.querySelectorAll('table tbody tr')).map((tr) => tr.querySelector('td p + p')?.innerText.trim())`)
        checar('"Só atrasados" deixa o Guarda-corpo e tira a Porta pivotante (a vencer) e a Janela',
          linhasAtraso.includes('Guarda-corpo') && !linhasAtraso.includes('Porta pivotante') && !linhasAtraso.includes('Janela de correr'),
          JSON.stringify(linhasAtraso))

        await b.ir(`${BASE}/execucao?obra=${ctExe.obra_id}`)
        await b.esperar('document.querySelector(\'button[aria-label="Apontar Porta pivotante"]\')', { rotulo: 'botão da Porta', ms: 25000 })
        await b.clicar('button[aria-label="Apontar Porta pivotante"]')
        await b.esperar('document.querySelector("#prev-ent")', { rotulo: 'painel da Porta' })
        checar('o painel traz a previsão gravada no campo da entrega', (await b.avaliar('document.querySelector("#prev-ent").value')) === daqui3)
        await b.preencher('#prev-fab', new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10))
        await b.esperar('document.querySelector("#erro-prev-ent")', { rotulo: 'erro de ordem das previsões' })
        checar('previsão da entrega antes da fabricação é barrada no painel, com o Salvar desabilitado',
          (await b.avaliar('document.querySelector("#erro-prev-ent").innerText')).includes('não pode ser antes da de fabricação') &&
            (await b.avaliar('Array.from(document.querySelectorAll("button")).find((x) => x.innerText.includes("Salvar apontamento")).disabled')))
        await b.clicar('button', { texto: 'Cancelar' })
      } finally {
        await sb.from('execucao').update({ ent_previsao_fim: null }).eq('id', porta.id)
      }
    }
  }

  // 28. Documentos (automação, Fase 7), antes do passo 22 (que troca a
  //     sessão). Menu, listagem com filtro na URL, detalhe de um documento do
  //     gc-dev e a validação do envio pela tela — sem subir arquivo: o envio
  //     de verdade aciona o n8n (camada escrita, com VALIDACAO_ENVIO_REAL=1).
  {
    await b.ir(`${BASE}/`)
    await b.clicar('a[href="/documentos"]')
    await b.esperar('location.pathname === "/documentos"', { rotulo: '/documentos pelo menu' })
    await b.esperar('document.body.innerText.includes("Todos os status")', { rotulo: 'filtros de documentos' })
    checar('item "Documentos" do menu abre a caixa de entrada', (await b.url()) === '/documentos')
    await b.screenshot(`${SHOTS}/28-documentos.png`)

    await b.preencher('select[aria-label="Status"]', 'REVISAO_HUMANA')
    await b.esperar('location.search.includes("status=REVISAO_HUMANA")', { rotulo: 'filtro de status na URL' })
    checar('filtro de status vai para a URL', (await b.url()).includes('status=REVISAO_HUMANA'))

    const temLinha = await b.avaliar('Boolean(document.querySelector("table tbody tr"))')
    if (temLinha) {
      await b.clicar('table tbody tr')
      await b.esperar('location.pathname.startsWith("/documentos/")', { rotulo: 'detalhe do documento' })
      await b.esperar('document.body.innerText.includes("Itens lidos")', { rotulo: 'itens lidos' })
      const det = await b.texto()
      checar('detalhe mostra o status "Precisa de revisão" e a seção de itens', det.includes('Precisa de revisão') && det.includes('Itens lidos'), det.slice(0, 200))
      await b.screenshot(`${SHOTS}/28b-documento-detalhe.png`)
    } else {
      console.log('  nota  gc-dev sem documento em revisão: detalhe não exercitado')
    }

    await b.ir(`${BASE}/documentos`)
    await b.clicar('button', { texto: 'Enviar documento' })
    await b.esperar('document.querySelector("#envio_arquivo")', { rotulo: 'modal de envio' })
    await b.clicar('[role="dialog"] button', { texto: 'Enviar' })
    await b.esperar('document.body.innerText.includes("Escolha a obra")', { rotulo: 'validação do envio', ms: 5000 })
    checar('envio sem obra é barrado na tela, antes de subir qualquer arquivo', true)
    await b.clicar('[role="dialog"] button', { texto: 'Cancelar' })
  }

  // 22. Pendência de anexos: o ícone de excluir só aparece no anexo que a
  //     pessoa pode apagar. Um anexo do admin e um do comercial no avulso do
  //     passo 18; a tela é aberta como comercial, pelo cookie da sessão sem
  //     senha de scripts/sessao-dev.mjs. É o último passo: a sessão do admin
  //     não volta depois dele.
  {
    const sb = await clienteSupabase()
    const { data: av } = await sb.from('contratos').select('id, empresa_id').eq('numero', `${NUMERO}-AV`).maybeSingle()
    if (av) {
      const { createClient } = await import('@supabase/supabase-js')
      const com = await sessaoDePerfil('comercial')
      const sbCom = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
      await sbCom.auth.setSession(com.session)
      const pdf = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' })
      const pasta = `${av.empresa_id}/contratos/${av.id}`
      const pAdmin = `${pasta}/1_do-admin.pdf`
      const pCom = `${pasta}/2_do-comercial.pdf`
      const { data: { user: adminUser } } = await sb.auth.getUser()
      const u1 = await sb.storage.from('anexos').upload(pAdmin, pdf, { contentType: 'application/pdf' })
      const u2 = await sbCom.storage.from('anexos').upload(pCom, pdf, { contentType: 'application/pdf' })
      const meta = (path, nome, por) => ({ nome, path, tipo: 'application/pdf', tamanho: 4, uploaded_at: new Date().toISOString(), uploaded_by: por })
      await sb.from('contratos').update({
        anexos: [meta(pAdmin, 'do-admin.pdf', adminUser.id), meta(pCom, 'do-comercial.pdf', com.user.id)],
      }).eq('id', av.id)
      checar('anexos do admin e do comercial montados', !u1.error && !u2.error, u1.error?.message ?? u2.error?.message)

      const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]
      await b.limparSessao()
      await b.definirCookie(`sb-${ref}-auth-token`, `base64-${Buffer.from(JSON.stringify(com.session)).toString('base64url')}`, BASE)
      await b.ir(`${BASE}/contratos/${av.id}`)
      await b.esperar('Array.from(document.querySelectorAll("[role=tab]")).some((t) => t.innerText.startsWith("Anexos"))', { rotulo: 'detalhe como comercial', ms: 25000 })
      await b.clicar('[role=tab]', { texto: 'Anexos' })
      await b.esperar('document.body.innerText.includes("do-comercial.pdf")', { rotulo: 'aba Anexos como comercial' })
      const botoes = await b.avaliar(`({
        admin: Boolean(document.querySelector('button[aria-label="Excluir do-admin.pdf"]')),
        proprio: Boolean(document.querySelector('button[aria-label="Excluir do-comercial.pdf"]')),
      })`)
      checar('como comercial, o ícone de excluir some no anexo do admin e aparece no dele',
        !botoes.admin && botoes.proprio, JSON.stringify(botoes))
      await b.screenshot(`${SHOTS}/26-anexos-como-comercial.png`)

      await sb.storage.from('anexos').remove([pAdmin, pCom])
    }
  }

  const errosReais = b.erros.filter((e) => !/favicon|Download the React DevTools/i.test(e))
  checar('nenhum erro de console', errosReais.length === 0, errosReais.join(' | '))
} catch (e) {
  falhas++
  console.log(`  FALHA no roteiro: ${e.message}`)
  try { await b.screenshot(`${SHOTS}/99-erro.png`) } catch {}
} finally {
  b.fechar()
  await limparRestosDoRoteiro()
  await limparAuditoria()
}

/**
 * Rede de segurança: apaga a proposta desta rodada (e seus itens e fotos) se
 * o roteiro não chegou a apagá-la pela tela.
 *
 * Até 2026-09-22 a limpeza existia só como PASSO do roteiro ("exclusão pela
 * tela funciona e nada sobra"). Quando um passo anterior falhava, o `catch`
 * pulava direto para o fim e a proposta ficava em gc-dev — havia 6 `RUN-*`
 * acumuladas de rodadas que quebraram no meio. A camada de escrita já limpava
 * em `finally`; esta passou a limpar também.
 *
 * Só a proposta DESTA rodada (`NUMERO`), nunca um `RUN-*` qualquer: duas
 * rodadas em paralelo apagariam a proposta uma da outra no meio do roteiro.
 */
/** Cliente Supabase logado como o usuário da validação, criado uma vez. */
async function clienteSupabase() {
  if (_sb) return _sb
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const { error } = await sb.auth.signInWithPassword({ email: EMAIL, password: SENHA })
  if (error) throw new Error(`login do cliente Supabase falhou: ${error.message}`)
  _sb = sb
  return sb
}

async function limparRestosDoRoteiro() {
  try {
    const sb = await clienteSupabase()

    // Contratos gerados pelo passo 17 (6.2). Sem itens: a PROP-2026-008 não tem.
    // E o avulso do passo 18 (6.3), `${NUMERO}-AV`.
    // E o do passo 21, `${NUMERO}-CI1`, que tem itens: eles saem antes.
    const { data: ctRestos } = await sb.from('contratos').select('id')
      .or(`numero.like.${NUMERO}-CT%,numero.eq.${NUMERO}-AV,numero.like.${NUMERO}-CI%`)
    if ((ctRestos ?? []).length > 0) {
      await sb.from('itens').delete().in('contrato_id', ctRestos.map((c) => c.id))
      await sb.from('contratos').delete().in('id', ctRestos.map((c) => c.id))
      console.log(`  limpeza: ${ctRestos.length} contrato(s) ${NUMERO}-CT*/-AV apagado(s)`)
    }

    // Contato do passo 25, se o roteiro parou antes de excluí-lo pela tela.
    const { data: ctContato } = await sb.from('contatos_whatsapp').delete().eq('nome', `${NUMERO} contato`).select('id')
    if (ctContato?.length) console.log(`  limpeza: ${ctContato.length} contato(s) ${NUMERO} apagado(s)`)

    const { data: restos } = await sb.from('propostas').select('id').in('numero', [NUMERO, `${NUMERO}-CI`])
    for (const { id } of restos ?? []) {
      const { data: comFoto } = await sb
        .from('itens').select('foto_url').eq('proposta_id', id).not('foto_url', 'is', null)
      const paths = (comFoto ?? []).map((i) => i.foto_url).filter(Boolean)
      if (paths.length > 0) await sb.storage.from('anexos').remove(paths)
      await sb.from('itens').delete().eq('proposta_id', id)
      await sb.from('propostas').delete().eq('id', id)
      console.log(`  limpeza: proposta ${id} desta rodada apagada no finally`)
    }
  } catch (e) {
    console.log(`  aviso limpeza: ${e.message} — confira ${NUMERO} à mão`)
  }
}

/** Os eventos que a rodada gerou no trigger de auditoria (13.2). */
async function limparAuditoria() {
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
      auth: { persistSession: false },
    })
    const r = await limparAuditoriaDoRoteiro(svc, INICIO_AUDITORIA)
    if (r.error) console.log(`  aviso limpeza da auditoria: ${r.error.message}`)
    else console.log(`  limpeza: ${r.apagados} evento(s) de auditoria da rodada`)
  } catch (e) {
    console.log(`  aviso limpeza da auditoria: ${e.message}`)
  }
}

console.log(`\n${passos - falhas}/${passos} passos ok · screenshots em ${SHOTS}`)
process.exit(falhas === 0 ? 0 : 1)
