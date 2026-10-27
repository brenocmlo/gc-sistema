/**
 * Gravação dos registros montados, com a chave de serviço, na ordem das FKs:
 * clientes → obras → propostas → itens → contratos → itens do contrato →
 * aditivos → execução → NF → pagamentos → FD.
 *
 * Contratos (decisão 2 do 14.1): replica o que a `gerar_contrato_de_proposta`
 * faz — contrato da proposta aprovada, valor = soma dos itens (o trigger do
 * 5.6 mantém), itens COPIADOS sem foto — sem chamá-la: ela grava
 * `created_by = auth.uid()`, nulo com a chave de serviço. Aqui o autor é o
 * `created_by`, `data_assinatura` fica nula e a observação leva a marca
 * [importacao:contrato-<número>]. Obra que já tem contrato não rescindido de
 * fora da importação não ganha outro: as aprovadas viram aditivos dele e a
 * execução fica nos itens da proposta (aviso em `resumo.contratos.pulados`).
 *
 * Idempotente: cada entidade procura antes o que já existe pela chave de
 * negócio (nome do cliente, código da obra, número da proposta, proposta +
 * número do item, item + sequencial, número + série da NF, marca
 * [importacao:…] no pagamento e no FD). O que existe fica como está e conta
 * como "já existia"; rodar duas vezes não duplica nem sobrescreve.
 *
 * O status da NF não é gravado: nasce emitida (ou cancelada) e o trigger dos
 * pagamentos o recalcula. A conciliação confere contra o da planilha.
 */
import { chaveDeComparacao } from '../../src/lib/importacao.ts'

const LOTE = 200

async function emLotes(lista, fn) {
  const saida = []
  for (let i = 0; i < lista.length; i += LOTE) saida.push(...(await fn(lista.slice(i, i + LOTE))))
  return saida
}

function falhar(etapa, error) {
  throw new Error(`${etapa}: ${error.message}${error.details ? ` (${error.details})` : ''}`)
}

/** Insere o que falta e devolve { criados, existentes, mapa chave → id }. */
async function garantir(svc, tabela, registros, { chave, existentes, linha }) {
  const ids = new Map(existentes)
  const novos = registros.filter((r) => !ids.has(chave(r)))
  const novasChaves = new Set(novos.map(chave))
  const inseridos = await emLotes(novos, async (lote) => {
    const { data, error } = await svc.from(tabela).insert(lote.map(linha)).select('*')
    if (error) falhar(`${tabela} (${lote[0].ref} em diante)`, error)
    return data
  })
  // A resposta volta na ordem do insert.
  novos.forEach((r, i) => ids.set(chave(r), inseridos[i].id))
  return { criados: novos.length, existentes: registros.length - novos.length, ids, novasChaves }
}

export async function gravarRegistros(svc, r, { empresaId, autorId, dataCorte = null }) {
  const resumo = {}
  const base = { empresa_id: empresaId }

  // clientes: pelo nome, sem acento e sem caixa
  const { data: cli, error: e1 } = await svc.from('clientes').select('id, nome').eq('empresa_id', empresaId)
  if (e1) falhar('clientes', e1)
  const c = await garantir(svc, 'clientes', r.clientes, {
    chave: (x) => chaveDeComparacao(x.nome),
    existentes: cli.map((x) => [chaveDeComparacao(x.nome), x.id]),
    linha: (x) => ({ ...base, nome: x.nome, created_by: autorId }),
  })
  resumo.clientes = c

  const { data: obs, error: e2 } = await svc.from('obras').select('id, codigo_obra').eq('empresa_id', empresaId)
  if (e2) falhar('obras', e2)
  const o = await garantir(svc, 'obras', r.obras, {
    chave: (x) => x.codigo_obra,
    existentes: obs.map((x) => [x.codigo_obra, x.id]),
    linha: (x) => ({
      ...base, codigo_obra: x.codigo_obra, nome: x.nome, cliente_id: c.ids.get(chaveDeComparacao(x.cliente)),
      cidade: x.cidade, endereco: x.endereco, data_inicio: x.data_inicio, status: x.status ?? 'ativa', created_by: autorId,
    }),
  })
  resumo.obras = o

  const { data: prs, error: e3 } = await svc.from('propostas').select('id, numero').eq('empresa_id', empresaId).in('numero', r.propostas.map((x) => x.numero).concat(['']))
  if (e3) falhar('propostas', e3)
  const p = await garantir(svc, 'propostas', r.propostas, {
    chave: (x) => x.numero,
    existentes: prs.map((x) => [x.numero, x.id]),
    linha: (x) => ({
      ...base, numero: x.numero, obra_id: o.ids.get(x.obra), status: x.status, valor_total: x.valor_total, desconto: x.desconto,
      descricao: x.descricao, data_emissao: x.data_emissao, data_envio: x.data_envio, data_decisao: x.data_decisao,
      motivo_rejeicao: x.motivo_rejeicao, detalhe_rejeicao: x.detalhe_rejeicao, condicoes_pagamento: x.condicoes_pagamento,
      observacao: x.observacao, created_by: autorId,
    }),
  })
  resumo.propostas = p

  const idsProp = [...p.ids.values()]
  const itensExistentes = idsProp.length
    ? (await emLotes(idsProp, async (lote) => {
        const { data, error } = await svc.from('itens').select('id, proposta_id, numero').in('proposta_id', lote)
        if (error) falhar('itens', error)
        return data
      }))
    : []
  const numeroDaProposta = new Map([...p.ids].map(([numero, id]) => [id, numero]))
  const i = await garantir(svc, 'itens', r.itens, {
    chave: (x) => `${x.proposta}|${x.numero}`,
    existentes: itensExistentes.map((x) => [`${numeroDaProposta.get(x.proposta_id)}|${x.numero}`, x.id]),
    linha: (x) => {
      const proposta = r.propostas.find((y) => y.numero === x.proposta)
      return {
        ...base, obra_id: o.ids.get(proposta.obra), proposta_id: p.ids.get(x.proposta), numero: x.numero,
        tipo: x.tipo, descricao: x.descricao, linha: x.linha, acabamento: x.acabamento, largura: x.largura, altura: x.altura,
        quantidade: x.quantidade, unidade: x.unidade, valor_unit: x.valor_unit, localizacao: x.localizacao, vidros: x.vidros,
        created_by: autorId,
      }
    },
  })
  resumo.itens = i

  // ---- contratos (decisão 2) ---------------------------------------------
  const contratosR = r.contratos ?? []
  const numerosCt = contratosR.map((x) => x.numero)
  const { data: ctsNum, error: e4 } = await svc.from('contratos').select('id, numero, obra_id').eq('empresa_id', empresaId).in('numero', numerosCt.concat(['']))
  if (e4) falhar('contratos', e4)
  const ctPorNumero = new Map(ctsNum.map((x) => [x.numero, x]))
  const idsObraCt = [...new Set(contratosR.map((x) => o.ids.get(x.obra)))]
  const { data: vigentes, error: e4b } = idsObraCt.length
    ? await svc.from('contratos').select('id, numero, obra_id').in('obra_id', idsObraCt).neq('status', 'rescindido')
    : { data: [], error: null }
  if (e4b) falhar('contratos vigentes', e4b)
  const pulados = [] // { contrato (montado), alvo: { id, numero } }
  const aCriar = []
  for (const x of contratosR) {
    const obraId = o.ids.get(x.obra)
    const mesmo = ctPorNumero.get(x.numero)
    if (mesmo && mesmo.obra_id !== obraId) throw new Error(`contratos: o número ${x.numero} já existe em outra obra; ajuste a coluna de contrato`)
    if (mesmo) { aCriar.push(x); continue }
    const outro = vigentes.find((v) => v.obra_id === obraId && !numerosCt.includes(v.numero))
    if (outro) pulados.push({ contrato: x, alvo: outro })
    else aCriar.push(x)
  }
  // Valor = soma dos itens já gravados da principal (como a função faz).
  const idsPrincipais = aCriar.map((x) => p.ids.get(x.proposta))
  const somaPorProposta = new Map()
  if (idsPrincipais.length) {
    for (const it of await emLotes(idsPrincipais, async (lote) => {
      const { data, error } = await svc.from('itens').select('proposta_id, valor_total').in('proposta_id', lote)
      if (error) falhar('itens das principais', error)
      return data
    })) somaPorProposta.set(it.proposta_id, Math.round(((somaPorProposta.get(it.proposta_id) ?? 0) + Number(it.valor_total ?? 0)) * 100) / 100)
  }
  const ct = await garantir(svc, 'contratos', aCriar, {
    chave: (x) => x.numero,
    existentes: ctsNum.map((x) => [x.numero, x.id]),
    linha: (x) => {
      const idProp = p.ids.get(x.proposta)
      return {
        ...base, obra_id: o.ids.get(x.obra), proposta_origem_id: idProp, numero: x.numero, descricao: x.descricao,
        data_assinatura: null, valor_total: somaPorProposta.get(idProp) ?? x.valor_total, desconto: x.desconto,
        condicoes_pagamento: x.condicoes_pagamento, observacao: x.observacao, status: x.status, historico: [],
        created_by: autorId,
      }
    },
  })
  resumo.contratos = { ...ct, pulados: pulados.map((x) => `obra ${x.contrato.obra} já tem o contrato ${x.alvo.numero}: ${x.contrato.numero} não foi criado; as aprovadas viram aditivo dele e a execução fica nos itens da proposta`) }

  // Itens do contrato: cópia dos da principal (sem foto, como a função).
  const numerosPulados = new Set(pulados.map((x) => x.contrato.numero))
  const itensCt = (r.itensContrato ?? []).filter((x) => !numerosPulados.has(x.contrato))
  const idsCt = [...ct.ids.values()]
  const itensCtExistentes = idsCt.length
    ? await emLotes(idsCt, async (lote) => {
        const { data, error } = await svc.from('itens').select('id, contrato_id, numero').in('contrato_id', lote)
        if (error) falhar('itens do contrato', error)
        return data
      })
    : []
  const numeroDoContrato = new Map([...ct.ids].map(([numero, id]) => [id, numero]))
  const ic = await garantir(svc, 'itens', itensCt, {
    chave: (x) => `contrato:${x.contrato}|${x.numero}`,
    existentes: itensCtExistentes.map((x) => [`contrato:${numeroDoContrato.get(x.contrato_id)}|${x.numero}`, x.id]),
    linha: (x) => {
      const contrato = contratosR.find((y) => y.numero === x.contrato)
      return {
        ...base, obra_id: o.ids.get(contrato.obra), proposta_id: null, contrato_id: ct.ids.get(x.contrato), numero: x.numero,
        tipo: x.tipo, descricao: x.descricao, linha: x.linha, acabamento: x.acabamento, largura: x.largura, altura: x.altura,
        quantidade: x.quantidade, unidade: x.unidade, valor_unit: x.valor_unit, localizacao: x.localizacao, vidros: x.vidros,
        created_by: autorId,
      }
    },
  })
  resumo.itensContrato = ic

  // Aditivos: as outras aprovadas da obra (e, na obra com contrato de fora, todas).
  const alvoAditivo = new Map() // nº da proposta → id do contrato
  for (const x of contratosR) {
    if (numerosPulados.has(x.numero)) continue
    for (const a of x.aditivos) alvoAditivo.set(a, ct.ids.get(x.numero))
  }
  for (const { contrato: x, alvo } of pulados) for (const a of [x.proposta, ...x.aditivos]) alvoAditivo.set(a, alvo.id)
  const resumoAditivos = { criados: 0, existentes: 0 }
  if (alvoAditivo.size) {
    const { data: atuais, error } = await svc.from('propostas').select('id, numero, contrato_aditivo_id').eq('empresa_id', empresaId).in('numero', [...alvoAditivo.keys()])
    if (error) falhar('aditivos', error)
    for (const a of atuais) {
      const alvo = alvoAditivo.get(a.numero)
      if (a.contrato_aditivo_id === alvo) { resumoAditivos.existentes += 1; continue }
      const { error: eu } = await svc.from('propostas').update({ contrato_aditivo_id: alvo }).eq('id', a.id)
      if (eu) falhar(`aditivo ${a.numero}`, eu)
      resumoAditivos.criados += 1
    }
  }
  resumo.aditivos = resumoAditivos

  // ---- execução: no item do contrato (decisão 2) ---------------------------
  const execucoesR = r.execucoes.map((x) => (x.contrato && numerosPulados.has(x.contrato) ? { ...x, item: x.item_proposta } : x))
  const idsDoItem = new Map([...i.ids, ...ic.ids])
  const idsItem = [...idsDoItem.values()]
  const execExistentes = idsItem.length
    ? await emLotes(idsItem, async (lote) => {
        const { data, error } = await svc.from('execucao').select('id, item_id, sequencial').in('item_id', lote)
        if (error) falhar('execução', error)
        return data
      })
    : []
  const chaveDoItem = new Map([...idsDoItem].map(([chave, id]) => [id, chave]))
  const ex = await garantir(svc, 'execucao', execucoesR, {
    chave: (x) => `${x.item}|${x.sequencial}`,
    existentes: execExistentes.map((x) => [`${chaveDoItem.get(x.item_id)}|${x.sequencial}`, x.id]),
    linha: (x) => ({
      ...base, item_id: idsDoItem.get(x.item), sequencial: x.sequencial, quantidade_total: x.quantidade_total,
      fab_qtd: x.fab_qtd, ent_qtd: x.ent_qtd, inst_qtd: x.inst_qtd, med_qtd: x.med_qtd,
      localizacao: x.localizacao, inst_responsavel: x.inst_responsavel, inst_observacao: x.inst_observacao,
    }),
  })
  resumo.execucoes = ex

  // Decisão 3: medição importada (med > 0) com a data de corte no histórico, e
  // não a do dia da importação (o trigger grava current_date). Só nas criadas agora.
  const comMedicao = execucoesR.filter((x) => x.med_qtd > 0 && ex.novasChaves.has(`${x.item}|${x.sequencial}`)).map((x) => ex.ids.get(`${x.item}|${x.sequencial}`))
  if (dataCorte && comMedicao.length) {
    await emLotes(comMedicao, async (lote) => {
      const { error } = await svc.from('execucao_medicoes').update({ data: dataCorte }).in('execucao_id', lote)
      if (error) falhar('datas da medição', error)
      return []
    })
  }

  const { data: nfs, error: e5 } = await svc.from('notas_fiscais').select('id, numero, serie').eq('empresa_id', empresaId).in('numero', r.notas.map((x) => x.numero).concat(['']))
  if (e5) falhar('notas fiscais', e5)
  const n = await garantir(svc, 'notas_fiscais', r.notas, {
    chave: (x) => `${x.numero}|${x.serie ?? ''}`,
    existentes: nfs.map((x) => [`${x.numero}|${x.serie ?? ''}`, x.id]),
    linha: (x) => ({
      ...base, numero: x.numero, serie: x.serie, obra_id: o.ids.get(x.obra), proposta_id: x.proposta ? p.ids.get(x.proposta) : null,
      tipo: x.tipo, valor_total: x.valor_total, data_emissao: x.data_emissao, data_vencimento: x.data_vencimento,
      chave_nfe: x.chave_nfe, status: x.cancelada ? 'cancelada' : 'emitida',
      motivo_cancelamento: x.cancelada ? 'Cancelada na planilha legada (importação)' : null, created_by: autorId,
    }),
  })
  resumo.notas = n

  // pagamentos e FD: pela marca na observação
  const marcados = async (tabela, coluna, ids) => {
    if (ids.length === 0) return []
    return emLotes(ids, async (lote) => {
      const { data, error } = await svc.from(tabela).select('id, observacao').in(coluna, lote).like('observacao', '%[importacao:%')
      if (error) falhar(tabela, error)
      return data
    })
  }
  const marca = (obs) => obs?.match(/\[importacao:([^\]]+)\]/)?.[1]
  const pgs = await marcados('pagamentos', 'nota_id', [...n.ids.values()])
  resumo.pagamentos = await garantir(svc, 'pagamentos', r.pagamentos, {
    chave: (x) => x.chave,
    existentes: pgs.map((x) => [marca(x.observacao), x.id]),
    linha: (x) => {
      const nota = r.notas.find((y) => `${y.numero}|${y.serie ?? ''}` === x.nota)
      return {
        ...base, origem: 'nf', nota_id: n.ids.get(x.nota), obra_id: o.ids.get(nota.obra), valor: x.valor,
        data_pagamento: x.data_pagamento, forma: x.forma, observacao: x.observacao, created_by: autorId,
      }
    },
  })

  const fdsEx = await marcados('fd', 'obra_id', [...o.ids.values()])
  resumo.fds = await garantir(svc, 'fd', r.fds, {
    chave: (x) => x.chave,
    existentes: fdsEx.map((x) => [marca(x.observacao), x.id]),
    linha: (x) => ({
      ...base, obra_id: o.ids.get(x.obra), fornecedor: x.fornecedor, data_lancamento: x.data_lancamento, valor: x.valor,
      valor_descontar: x.valor_descontar, codigo: x.codigo, especificacao: x.especificacao, quantidade: x.quantidade,
      unidade: x.unidade, preco_unitario: x.preco_unitario, data_vencimento: x.data_vencimento, data_pagamento: x.data_pagamento,
      pedido_documento: x.pedido_documento, item_parcela: x.item_parcela, observacao: x.observacao, created_by: autorId,
    }),
  })

  for (const k of Object.keys(resumo)) { delete resumo[k].ids; delete resumo[k].novasChaves }
  return resumo
}

/**
 * Desfaz a importação desta planilha em gc-dev, na ordem inversa das FKs: só o
 * que a planilha identifica (marca, número, código). Contrato só sai se tiver a
 * marca [importacao:…]; contrato de fora a que a importação ligou aditivos fica,
 * e só a ligação se desfaz. Cliente só sai se não
 * sobrar obra dele. Para repetir em dev até acertar; nunca em produção.
 */
export async function desfazerRegistros(svc, r, { empresaId }) {
  const apagados = {}
  const del = async (rotulo, q) => {
    const { data, error } = await q.select('id')
    if (error) falhar(`desfazer ${rotulo}`, error)
    apagados[rotulo] = (apagados[rotulo] ?? 0) + data.length
  }
  const { data: obras } = await svc.from('obras').select('id').eq('empresa_id', empresaId).in('codigo_obra', r.obras.map((x) => x.codigo_obra).concat(['']))
  const idsObra = (obras ?? []).map((x) => x.id)
  if (idsObra.length) {
    await del('fd', svc.from('fd').delete().in('obra_id', idsObra).like('observacao', '%[importacao:%'))
    await del('pagamentos', svc.from('pagamentos').delete().in('obra_id', idsObra).like('observacao', '%[importacao:%'))
  }
  for (const nf of r.notas) {
    let q = svc.from('notas_fiscais').delete().eq('empresa_id', empresaId).eq('numero', nf.numero)
    q = nf.serie == null ? q.is('serie', null) : q.eq('serie', nf.serie)
    await del('notas_fiscais', q)
  }
  // Contratos da importação (marca na observação): execução dos itens do
  // contrato → itens do contrato → aditivos soltos → contratos. Antes de
  // propostas e obras: a FK de obra em contratos é `restrict`.
  const { data: props } = await svc.from('propostas').select('id').eq('empresa_id', empresaId).in('numero', r.propostas.map((x) => x.numero).concat(['']))
  const idsProp = (props ?? []).map((x) => x.id)
  const { data: cts } = await svc.from('contratos').select('id').eq('empresa_id', empresaId).in('numero', (r.contratos ?? []).map((x) => x.numero).concat(['']))
    .like('observacao', '%[importacao:%')
  const idsCt = (cts ?? []).map((x) => x.id)
  if (idsCt.length) {
    const { data: itensCt } = await svc.from('itens').select('id').in('contrato_id', idsCt)
    const idsItemCt = (itensCt ?? []).map((x) => x.id)
    if (idsItemCt.length) await del('execucao', svc.from('execucao').delete().in('item_id', idsItemCt))
    await del('itens_contrato', svc.from('itens').delete().in('contrato_id', idsCt))
  }
  if (idsProp.length) {
    const { data: soltos, error } = await svc.from('propostas').update({ contrato_aditivo_id: null }).in('id', idsProp).not('contrato_aditivo_id', 'is', null).select('id')
    if (error) falhar('desfazer aditivos', error)
    apagados.aditivos = soltos.length
  }
  if (idsCt.length) await del('contratos', svc.from('contratos').delete().in('id', idsCt))
  if (idsProp.length) {
    const { data: itens } = await svc.from('itens').select('id').in('proposta_id', idsProp)
    const idsItem = (itens ?? []).map((x) => x.id)
    if (idsItem.length) await del('execucao', svc.from('execucao').delete().in('item_id', idsItem))
    await del('itens', svc.from('itens').delete().in('proposta_id', idsProp))
    await del('propostas', svc.from('propostas').delete().in('id', idsProp))
  }
  if (idsObra.length) await del('obras', svc.from('obras').delete().in('id', idsObra))
  for (const cl of r.clientes) {
    const { data: achados } = await svc.from('clientes').select('id, nome, obras(id)').eq('empresa_id', empresaId).ilike('nome', cl.nome)
    for (const a of achados ?? []) {
      if (chaveDeComparacao(a.nome) === chaveDeComparacao(cl.nome) && (a.obras ?? []).length === 0) {
        await del('clientes', svc.from('clientes').delete().eq('id', a.id))
      }
    }
  }
  return apagados
}

