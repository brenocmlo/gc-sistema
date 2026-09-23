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
// Declarado aqui em cima: o roteiro chama clienteSupabase() antes da linha
// em que a função é declarada, e `let` embaixo cairia na zona morta.
let _sb = null

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

  // 7d. Importação por planilha (bloco 5.4), com um .xlsx DE VERDADE.
  // Até 2026-09-22 este passo só abria e fechava o modal: o parse com exceljs
  // no navegador não tinha cobertura. A planilha é montada aqui com as colunas
  // e as instruções reais do template (lidas da lib), e sobe pelo input.
  {
    const { COLUNAS_IMPORTACAO, INSTRUCOES_TEMPLATE } = await import('../src/lib/itens-form.ts')
    const { default: ExcelJS } = await import('exceljs')
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Itens')
    const linha = (v) => COLUNAS_IMPORTACAO.map((c) => v[c.chave] ?? null)
    for (const i of INSTRUCOES_TEMPLATE) ws.addRow([i])
    ws.addRow([])
    ws.addRow(COLUNAS_IMPORTACAO.map((c) => c.titulo))
    ws.addRow(linha(Object.fromEntries(COLUNAS_IMPORTACAO.map((c) => [c.chave, c.exemplo]))))
    ws.addRow(linha({ numero: 50, tipo: 'Janela', descricao: 'Importada 1', quantidade: 2, unidade: 'M2', valor_unit: 150 }))
    ws.addRow(linha({ numero: 51, tipo: 'Porta', descricao: 'Importada 2', quantidade: 1, unidade: 'QTD', valor_unit: 200 }))
    ws.addRow(linha({ numero: 52, tipo: 'Erro', descricao: 'Quantidade zero', quantidade: 0, unidade: 'QTD', valor_unit: 10 }))
    const planilha = `${SHOTS}/importacao-do-run.xlsx`
    writeFileSync(planilha, Buffer.from(await wb.xlsx.writeBuffer()))

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
    checar('o preview lê a planilha no navegador: 4 linhas, 2 válidas, 2 com erro',
      /4 linhas/.test(preview) && /2 válidas/.test(preview) && /2 com erro/.test(preview),
      preview.match(/Confira antes de gravar[\s\S]{0,80}/)?.[0])
    checar('a linha de exemplo do template é recusada no preview',
      /linha de exemplo do template/.test(preview))
    checar('a quantidade zero é recusada com o motivo', /Quantidade: Quantidade tem de ser maior que zero/.test(preview))
    const primeiraLinha = await b.avaliar(`document.querySelector('table[aria-label="Preview da importação"] tbody tr td')?.innerText.trim()`)
    checar('o preview numera pela linha real do Excel (exemplo na linha 8, não na 2)',
      primeiraLinha === String(INSTRUCOES_TEMPLATE.length + 3), `primeira linha do preview: ${primeiraLinha}`)
    await b.screenshot(`${SHOTS}/06d-importar-preview.png`)

    await b.clicar('button', { texto: 'Importar 2 itens' })
    await b.esperar('document.querySelectorAll(\'table[aria-label="Itens da proposta"] input[aria-label="Tipo"]\').length === 2', {
      rotulo: 'itens importados na tabela', ms: 30000,
    })
    const tipos = await b.avaliar(`Array.from(document.querySelectorAll('table[aria-label="Itens da proposta"] input[aria-label="Tipo"]')).map(i => i.value).join('|')`)
    checar('importar grava só as 2 válidas, e elas aparecem na tabela', tipos === 'Janela|Porta', tipos)
    checar('o relatório final diz quantos entraram e quantos ficaram de fora',
      /2 itens importados, 2 ignorados/.test(await b.texto()))
    await b.esperar('!document.body.innerText.includes("itens importados")', { rotulo: 'toast da importação sair', ms: 15000 })
  }

  // 7e. Divergência resolvida pela tela (bloco 5.6). O trigger mantém o valor
  // igual à soma (2×150 + 200 = 500); a divergência é criada do jeito que ela
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
    checar('o aviso mostra os dois valores', /9\.999,00/.test(await b.texto()) && /500,00/.test(await b.texto()))
    await b.clicar('button', { texto: 'Usar a soma dos itens' })
    await b.esperar('!document.querySelector(\'[data-testid="aviso-divergencia"]\')', {
      rotulo: 'aviso sumir depois do clique', ms: 25000,
    })
    const { data: depois } = await sb.from('propostas').select('valor_total').eq('id', idProposta).maybeSingle()
    checar('o clique em "Usar a soma dos itens" grava a soma e o aviso some',
      Number(depois?.valor_total) === 500, `valor=${depois?.valor_total}`)
    await b.esperar('!document.body.innerText.includes("ajustado para a soma")', { rotulo: 'toast do ajuste sair', ms: 15000 })
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
  await b.viewport(1440, 900)

  const errosReais = b.erros.filter((e) => !/favicon|Download the React DevTools/i.test(e))
  checar('nenhum erro de console', errosReais.length === 0, errosReais.join(' | '))
} catch (e) {
  falhas++
  console.log(`  FALHA no roteiro: ${e.message}`)
  try { await b.screenshot(`${SHOTS}/99-erro.png`) } catch {}
} finally {
  b.fechar()
  await limparRestosDoRoteiro()
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

    const { data: restos } = await sb.from('propostas').select('id').eq('numero', NUMERO)
    for (const { id } of restos ?? []) {
      const { data: comFoto } = await sb
        .from('itens').select('foto_url').eq('proposta_id', id).not('foto_url', 'is', null)
      const paths = (comFoto ?? []).map((i) => i.foto_url).filter(Boolean)
      if (paths.length > 0) await sb.storage.from('anexos').remove(paths)
      await sb.from('itens').delete().eq('proposta_id', id)
      await sb.from('propostas').delete().eq('id', id)
      console.log(`  limpeza: ${NUMERO} ficou para trás e foi apagada no finally`)
    }
  } catch (e) {
    console.log(`  aviso limpeza: ${e.message} — confira ${NUMERO} à mão`)
  }
}

console.log(`\n${passos - falhas}/${passos} passos ok · screenshots em ${SHOTS}`)
process.exit(falhas === 0 ? 0 : 1)
