/**
 * Linhas lidas da planilha → registros prontos para gravar, na ordem das FKs.
 * Não toca no banco. Toda linha recusada vai para `ignoradas` com o motivo;
 * todo valor deduzido (a cascata da decisão 3, o status padrão) vai para
 * `avisos`. Os vínculos entre abas são por chave de negócio (código da obra,
 * número da proposta, item, número da NF), resolvidos aqui.
 *
 * Decisão 2 do 14.1: cada obra com proposta aprovada ganha UM contrato, da
 * aprovada principal, com cópia dos itens dela (`itensContrato`); a execução
 * dos itens da principal vai para o item do contrato (chave
 * `contrato:<número>|<item>`), e as outras aprovadas são aditivos dele.
 */
import {
  cascataDaExecucao,
  chaveDeComparacao,
  conferenciaDaMedicao,
  contratosDaImportacao,
  datasDoFd,
  chaveDeImportacao,
  codigoDeObraDoNome,
  dataDaPlanilha,
  formaDePagamento,
  nomeCanonicoDoCliente,
  normalizarTexto,
  numeroDaPlanilha,
  numeroDoContratoImportado,
  observacaoComMarca,
  statusContratoDaObra,
  statusNfDaPlanilha,
  statusObraDaPlanilha,
  statusPropostaDaPlanilha,
  unidadeDoFd,
  unidadeDoItem,
} from '../../src/lib/importacao.ts'

const texto = (v) => normalizarTexto(v) || null

export function montarRegistros(lido, mapa, { dataCorte = mapa.data_corte ?? null } = {}) {
  const ignoradas = []
  const avisos = []
  const ignorar = (l, motivo) => ignoradas.push({ ref: l.__ref, motivo })
  const avisar = (l, aviso) => avisos.push({ ref: l.__ref, aviso })
  const depoisDoCorte = (data) => dataCorte && data && data > dataCorte
  const linhasDe = (e) => lido[e]?.linhas ?? []
  const eq = mapa.clientes?.equivalencias ?? {}

  // ---- clientes e obras ------------------------------------------------
  const clientes = new Map() // chave → { nome }
  const obras = new Map() // codigo → registro
  const obraPorChave = new Map() // código ou nome comparável → codigo
  for (const l of linhasDe('obras')) {
    const nome = texto(l.nome)
    const cliente = nomeCanonicoDoCliente(l.cliente, eq)
    if (!nome) { ignorar(l, 'obra sem nome'); continue }
    if (!cliente) { ignorar(l, `obra "${nome}" sem cliente`); continue }
    const codigo = texto(l.codigo_obra) ?? codigoDeObraDoNome(nome)
    if (!texto(l.codigo_obra)) avisar(l, `obra sem código: "${codigo}", gerado do nome`)
    if (obras.has(codigo)) { ignorar(l, `obra ${codigo} repetida (a primeira vale)`); continue }
    clientes.set(chaveDeComparacao(cliente), { nome: cliente })
    let status = statusObraDaPlanilha(l.status)
    if (!status) {
      if (texto(l.status)) avisar(l, `obra ${codigo}: status "${normalizarTexto(l.status)}" não reconhecido, entra como ativa`)
      status = 'ativa'
    }
    obras.set(codigo, {
      codigo_obra: codigo, nome, cliente, ref: l.__ref, status,
      cidade: texto(l.cidade), endereco: texto(l.endereco), data_inicio: dataDaPlanilha(l.data_inicio),
    })
    obraPorChave.set(chaveDeComparacao(codigo), codigo)
    obraPorChave.set(chaveDeComparacao(nome), codigo)
  }
  const acharObra = (v) => obraPorChave.get(chaveDeComparacao(v)) ?? null

  // ---- propostas ---------------------------------------------------------
  const propostas = new Map() // numero → registro
  for (const l of linhasDe('propostas')) {
    const numero = texto(l.numero)
    const obra = acharObra(l.obra)
    const valor = numeroDaPlanilha(l.valor_total)
    if (!numero) { ignorar(l, 'proposta sem número'); continue }
    if (!obra) { ignorar(l, `proposta ${numero}: obra "${normalizarTexto(l.obra)}" não está na aba de obras`); continue }
    if (valor == null || valor < 0) { ignorar(l, `proposta ${numero}: valor inválido (${normalizarTexto(l.valor_total)})`); continue }
    if (propostas.has(numero)) { ignorar(l, `proposta ${numero} repetida (a primeira vale)`); continue }
    const desconto = numeroDaPlanilha(l.desconto) ?? 0
    if (desconto > valor) { ignorar(l, `proposta ${numero}: desconto maior que o valor`); continue }
    let status = statusPropostaDaPlanilha(l.status)
    if (!status) { status = 'enviada'; avisar(l, `proposta ${numero}: status "${normalizarTexto(l.status)}" não reconhecido, entra como enviada`) }
    if (l.cliente && chaveDeComparacao(nomeCanonicoDoCliente(l.cliente, eq)) !== chaveDeComparacao(obras.get(obra).cliente)) {
      avisar(l, `proposta ${numero}: cliente "${normalizarTexto(l.cliente)}" diferente do da obra ("${obras.get(obra).cliente}"); vale o da obra`)
    }
    const data = dataDaPlanilha(l.data_emissao)
    propostas.set(numero, {
      numero, obra, ref: l.__ref, status, valor_total: valor, desconto,
      descricao: texto(l.descricao), data_emissao: data, condicoes_pagamento: texto(l.condicoes_pagamento),
      data_envio: status !== 'rascunho' ? data : null, data_decisao: status === 'aprovada' || status === 'rejeitada' ? data : null,
      motivo_rejeicao: status === 'rejeitada' ? 'outro' : null,
      detalhe_rejeicao: status === 'rejeitada' ? 'Rejeitada na planilha legada (importação)' : null,
      observacao: l.link ? `Documento: ${normalizarTexto(l.link)}` : null,
      contrato_planilha: texto(l.contrato), aditivo_de: null,
    })
  }

  // ---- itens -------------------------------------------------------------
  const itens = new Map() // "proposta|numero" → registro
  for (const l of linhasDe('itens')) {
    const proposta = texto(l.proposta)
    const numero = numeroDaPlanilha(l.numero)
    if (!propostas.has(proposta)) { ignorar(l, `item: proposta "${proposta}" não está na aba de propostas`); continue }
    if (numero == null || !Number.isInteger(numero)) { ignorar(l, `item da proposta ${proposta}: número "${normalizarTexto(l.numero)}" não é inteiro`); continue }
    const chave = `${proposta}|${numero}`
    if (itens.has(chave)) { ignorar(l, `item ${numero} da proposta ${proposta} repetido`); continue }
    const quantidade = numeroDaPlanilha(l.quantidade)
    const valorUnit = numeroDaPlanilha(l.valor_unit)
    const unidade = unidadeDoItem(l.unidade)
    if (quantidade == null || quantidade < 0) { ignorar(l, `item ${chave}: quantidade inválida`); continue }
    if (valorUnit == null || valorUnit < 0) { ignorar(l, `item ${chave}: valor unitário inválido`); continue }
    if (!unidade) { ignorar(l, `item ${chave}: unidade "${normalizarTexto(l.unidade)}" não é QTD nem M2`); continue }
    itens.set(chave, {
      proposta, numero, ref: l.__ref, quantidade, valor_unit: valorUnit, unidade,
      tipo: texto(l.tipo), descricao: texto(l.descricao), linha: texto(l.linha), acabamento: texto(l.acabamento),
      largura: numeroDaPlanilha(l.largura), altura: numeroDaPlanilha(l.altura),
      localizacao: texto(l.localizacao), vidros: texto(l.vidros),
    })
  }

  // ---- contratos (decisão 2): um por obra com proposta aprovada -------------
  const cfgContratos = mapa.contratos ?? {}
  const contratos = []
  const contratoDaPrincipal = new Map() // nº da proposta principal → nº do contrato
  const contratoDoAditivo = new Map() // nº da proposta aditivo → nº do contrato
  const itensContrato = []
  if ((cfgContratos.gerar ?? 'um_por_obra') === 'um_por_obra') {
    for (const g of contratosDaImportacao([...propostas.values()], cfgContratos.principal)) {
      const pr = g.principal
      const numero = numeroDoContratoImportado(pr.numero, pr.contrato_planilha, cfgContratos.prefixo_numero ?? 'CT-')
      const seus = [...itens.values()].filter((i) => i.proposta === pr.numero)
      // Com itens, o valor é a soma deles (como a gerar_contrato_de_proposta); sem, o da proposta.
      const valor = seus.length ? Math.round(seus.reduce((a, i) => a + i.quantidade * i.valor_unit, 0) * 100) / 100 : pr.valor_total
      if (pr.desconto > valor) {
        ignorar({ __ref: pr.ref }, `contrato da obra ${g.obra}: a soma dos itens da proposta ${pr.numero} (${valor}) fica abaixo do desconto (${pr.desconto}); obra sem contrato`)
        continue
      }
      if (contratos.some((c) => c.numero === numero)) {
        ignorar({ __ref: pr.ref }, `contrato ${numero} repetido (coluna de contrato com o mesmo número em duas obras); obra ${g.obra} sem contrato`)
        continue
      }
      const chave = `contrato-${numero}`
      contratos.push({
        numero, obra: g.obra, proposta: pr.numero, ref: pr.ref, aditivos: g.aditivos.map((a) => a.numero),
        status: statusContratoDaObra(obras.get(g.obra).status), valor_total: valor, desconto: pr.desconto,
        descricao: pr.descricao, condicoes_pagamento: pr.condicoes_pagamento,
        observacao: observacaoComMarca({
          texto: `Gerado da proposta ${pr.numero} aprovada na planilha legada; sem contrato assinado registrado.`, chave,
        }),
      })
      contratoDaPrincipal.set(pr.numero, numero)
      for (const a of g.aditivos) {
        contratoDoAditivo.set(a.numero, numero)
        a.aditivo_de = numero
        avisar({ __ref: a.ref }, `proposta ${a.numero}: aprovada na mesma obra que a ${pr.numero}; entra como aditivo do contrato ${numero}`)
      }
      for (const i of seus) itensContrato.push({ ...i, contrato: numero, ref: i.ref })
    }
  }

  // ---- execução: N por item, sequencial pela ordem da aba ------------------
  const execucoes = []
  const porItem = new Map()
  for (const l of linhasDe('execucao')) {
    const chave = `${texto(l.proposta)}|${numeroDaPlanilha(l.item)}`
    if (!itens.has(chave)) { ignorar(l, `execução: item ${chave.replace('|', ' / item ')} não está na aba de itens`); continue }
    porItem.set(chave, [...(porItem.get(chave) ?? []), l])
  }
  for (const [chave, linhas] of porItem) {
    const item = itens.get(chave)
    // Decisão 2: a execução da principal vai para o item do contrato.
    const contrato = contratoDaPrincipal.get(item.proposta)
    const chaveItem = contrato ? `contrato:${contrato}|${item.numero}` : chave
    if (!contrato) {
      const motivo = contratoDoAditivo.has(item.proposta)
        ? `a proposta ${item.proposta} é aditivo do contrato ${contratoDoAditivo.get(item.proposta)}`
        : `a proposta ${item.proposta} não está aprovada (sem contrato)`
      avisar(linhas[0], `execução do item ${chave}: ${motivo}; a execução fica no item da proposta`)
    }
    let sequencial = 0
    for (const l of linhas) {
      // Uma linha só: o total é o do item. Várias: cada uma diz a sua quantidade.
      const total = numeroDaPlanilha(l.quantidade) ?? (linhas.length === 1 ? item.quantidade : null)
      if (total == null) { ignorar(l, `execução do item ${chave}: o item tem ${linhas.length} linhas e esta não diz a quantidade`); continue }
      const c = cascataDaExecucao({
        total, fabricada: numeroDaPlanilha(l.fabricada), entregue: numeroDaPlanilha(l.entregue),
        instalada: numeroDaPlanilha(l.instalada), medida: numeroDaPlanilha(l.medida),
      })
      if (!c.ok) { ignorar(l, `execução do item ${chave}: ${c.motivo}`); continue }
      for (const a of c.ajustes) avisar(l, `execução do item ${chave}: ${a}`)
      sequencial += 1
      execucoes.push({
        item: chaveItem, item_proposta: chave, contrato: contrato ?? null, sequencial, ref: l.__ref, quantidade_total: total,
        fab_qtd: c.cascata.fab, ent_qtd: c.cascata.ent, inst_qtd: c.cascata.inst, med_qtd: c.cascata.med,
        localizacao: texto(l.localizacao), inst_responsavel: texto(l.responsavel), inst_observacao: texto(l.observacao),
      })
    }
  }

  // ---- notas fiscais -------------------------------------------------------
  const notas = new Map() // "numero|serie" → registro
  const tipos = Object.fromEntries(Object.entries(mapa.tipos_nf ?? {}).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [chaveDeComparacao(k), v]))
  for (const l of linhasDe('notas_fiscais')) {
    const numero = texto(l.numero)
    const serie = texto(l.serie)
    const obra = acharObra(l.obra)
    const valor = numeroDaPlanilha(l.valor_total)
    const emissao = dataDaPlanilha(l.data_emissao)
    if (!numero) { ignorar(l, 'NF sem número'); continue }
    if (!obra) { ignorar(l, `NF ${numero}: obra "${normalizarTexto(l.obra)}" não está na aba de obras`); continue }
    if (!valor || valor <= 0) { ignorar(l, `NF ${numero}: valor tem de ser maior que zero`); continue }
    if (!emissao) { ignorar(l, `NF ${numero}: sem data de emissão válida`); continue }
    if (depoisDoCorte(emissao)) { ignorar(l, `NF ${numero}: emitida em ${emissao}, depois da data de corte (${dataCorte})`); continue }
    const chave = `${numero}|${serie ?? ''}`
    if (notas.has(chave)) { ignorar(l, `NF ${numero} série ${serie ?? '—'} repetida`); continue }
    const proposta = texto(l.proposta)
    if (proposta && !propostas.has(proposta)) avisar(l, `NF ${numero}: proposta "${proposta}" não importada; a NF entra sem vínculo`)
    const statusPlanilha = statusNfDaPlanilha(l.status)
    if (l.status && !statusPlanilha) avisar(l, `NF ${numero}: status "${normalizarTexto(l.status)}" não reconhecido`)
    const tipo = tipos[chaveDeComparacao(l.tipo)] ?? 'outro'
    notas.set(chave, {
      numero, serie, obra, ref: l.__ref, valor_total: valor, data_emissao: emissao,
      data_vencimento: dataDaPlanilha(l.data_vencimento), tipo, chave_nfe: texto(l.chave_nfe),
      proposta: proposta && propostas.has(proposta) ? proposta : null,
      cancelada: statusPlanilha === 'cancelada', status_planilha: statusPlanilha,
    })
  }
  // Decisão 3: NF de medição sem medição, ou acima do instalado, por obra.
  const porObraMed = new Map()
  const daObra = (obra) => porObraMed.get(obra) ?? porObraMed.set(obra, { nfMedicao: 0, somaMedida: 0, instaladoValor: 0 }).get(obra)
  for (const n of notas.values()) if (n.tipo === 'medicao' && !n.cancelada) daObra(n.obra).nfMedicao += n.valor_total
  for (const e of execucoes) {
    const item = itens.get(e.item_proposta)
    const m = daObra(propostas.get(item.proposta).obra)
    m.somaMedida += e.med_qtd
    m.instaladoValor += e.inst_qtd * item.valor_unit
  }
  for (const [obra, m] of porObraMed) {
    if (m.nfMedicao === 0) continue
    for (const c of conferenciaDaMedicao(m)) {
      avisar({ __ref: obras.get(obra).ref }, `obra ${obra}: ${c.tipo === 'divergencia' ? 'DIVERGÊNCIA ' : ''}${c.texto}`)
    }
  }

  const acharNota = (numero, serie) => {
    const n = texto(numero)
    if (serie != null && notas.has(`${n}|${texto(serie) ?? ''}`)) return `${n}|${texto(serie) ?? ''}`
    const candidatas = [...notas.keys()].filter((k) => k.split('|')[0] === n)
    return candidatas.length === 1 ? candidatas[0] : candidatas.length > 1 ? 'ambigua' : null
  }

  // ---- pagamentos ------------------------------------------------------------
  const pagamentos = []
  for (const l of linhasDe('pagamentos')) {
    const nota = acharNota(l.nf, l.serie)
    const valor = numeroDaPlanilha(l.valor)
    const data = dataDaPlanilha(l.data_pagamento)
    if (nota === 'ambigua') { ignorar(l, `pagamento: há mais de uma NF ${normalizarTexto(l.nf)}; preencha a série`); continue }
    if (!nota) { ignorar(l, `pagamento: NF "${normalizarTexto(l.nf)}" não está na aba de notas`); continue }
    if (!valor || valor <= 0) { ignorar(l, `pagamento da NF ${normalizarTexto(l.nf)}: valor tem de ser maior que zero`); continue }
    if (!data) { ignorar(l, `pagamento da NF ${normalizarTexto(l.nf)}: sem data válida`); continue }
    if (depoisDoCorte(data)) { ignorar(l, `pagamento de ${data}, depois da data de corte (${dataCorte})`); continue }
    if (notas.get(nota).cancelada) { ignorar(l, `pagamento da NF ${normalizarTexto(l.nf)}: a NF está cancelada`); continue }
    const chave = chaveDeImportacao('pagamento', [nota, data, valor, l.forma])
    pagamentos.push({
      nota, ref: l.__ref, valor, data_pagamento: data, forma: formaDePagamento(l.forma), chave,
      observacao: observacaoComMarca({ texto: [l.forma && formaDePagamento(l.forma) === 'outro' ? `Forma: ${normalizarTexto(l.forma)}` : '', normalizarTexto(l.observacao)].filter(Boolean).join(' · '), link: l.link, chave }),
    })
  }
  const chavesPg = new Set()
  for (const p of [...pagamentos]) {
    if (chavesPg.has(p.chave)) { ignorar({ __ref: p.ref }, 'pagamento repetido (mesma NF, data, valor e forma)'); pagamentos.splice(pagamentos.indexOf(p), 1) }
    chavesPg.add(p.chave)
  }

  // ---- FD ------------------------------------------------------------------
  const fds = []
  const chavesFd = new Set()
  for (const l of linhasDe('fd')) {
    const obra = acharObra(l.obra)
    const fornecedor = texto(l.fornecedor)
    const valor = numeroDaPlanilha(l.valor)
    if (!obra) { ignorar(l, `FD: obra "${normalizarTexto(l.obra)}" não está na aba de obras`); continue }
    if (!fornecedor) { ignorar(l, 'FD sem fornecedor'); continue }
    if (valor == null || valor < 0) { ignorar(l, `FD de ${fornecedor}: valor inválido`); continue }
    // Decisão 5: o corte olha lançamento ou pagamento, nunca o vencimento.
    const { data, dataDoCorte, soVencimento } = datasDoFd({
      lancamento: dataDaPlanilha(l.data_lancamento), vencimento: dataDaPlanilha(l.data_vencimento), pagamento: dataDaPlanilha(l.data_pagamento),
    })
    if (!data) { ignorar(l, `FD de ${fornecedor}: sem data de lançamento, vencimento ou pagamento`); continue }
    if (!dataDaPlanilha(l.data_lancamento)) avisar(l, `FD de ${fornecedor}: sem data de lançamento, usada ${data}`)
    if (depoisDoCorte(dataDoCorte)) { ignorar(l, `FD de ${fornecedor} em ${dataDoCorte}, depois da data de corte (${dataCorte})`); continue }
    if (soVencimento && depoisDoCorte(data)) avisar(l, `FD de ${fornecedor}: só tem vencimento (${data}), depois da data de corte; entra, porque o vencimento não é lançamento`)
    let descontar = numeroDaPlanilha(l.valor_descontar) ?? valor
    if (l.valor_descontar == null) avisar(l, `FD de ${fornecedor}: sem valor a descontar, assumido o valor inteiro`)
    if (descontar > valor) { ignorar(l, `FD de ${fornecedor}: valor a descontar (${descontar}) maior que o valor (${valor})`); continue }
    if (descontar < 0) descontar = 0
    const chave = chaveDeImportacao('fd', [obra, fornecedor, data, valor, l.item_parcela, l.pedido_documento])
    if (chavesFd.has(chave)) { ignorar(l, `FD de ${fornecedor} repetido (mesma obra, data, valor, parcela e documento)`); continue }
    chavesFd.add(chave)
    fds.push({
      obra, fornecedor, ref: l.__ref, chave, data_lancamento: data, valor, valor_descontar: descontar,
      codigo: texto(l.codigo), especificacao: texto(l.especificacao), quantidade: numeroDaPlanilha(l.quantidade),
      unidade: unidadeDoFd(l.unidade), preco_unitario: numeroDaPlanilha(l.preco_unitario),
      data_vencimento: dataDaPlanilha(l.data_vencimento), data_pagamento: dataDaPlanilha(l.data_pagamento),
      pedido_documento: texto(l.pedido_documento), item_parcela: texto(l.item_parcela),
      observacao: observacaoComMarca({ texto: l.observacao, link: l.link, chave }),
    })
  }

  return {
    clientes: [...clientes.values()], obras: [...obras.values()], propostas: [...propostas.values()],
    itens: [...itens.values()], contratos, itensContrato, execucoes, notas: [...notas.values()], pagamentos, fds,
    ignoradas, avisos,
  }
}

/** Totais para a conciliação (14.3) e para o relatório do dry-run. */
export function totaisDosRegistros(r) {
  const soma = (xs, f) => Math.round(xs.reduce((a, x) => a + (f(x) ?? 0), 0) * 100) / 100
  return {
    nf_emitida: soma(r.notas.filter((n) => !n.cancelada), (n) => n.valor_total),
    recebido: soma(r.pagamentos, (p) => p.valor),
    fd_valor: soma(r.fds, (f) => f.valor),
    fd_a_descontar: soma(r.fds, (f) => f.valor_descontar),
  }
}
