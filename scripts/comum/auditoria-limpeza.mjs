/**
 * Limpeza dos eventos de auditoria (bloco 13.2) que uma camada do plano de
 * validação gerou.
 *
 * O trigger `auditar_mudanca` registra toda escrita, inclusive as de teste:
 * sem isto, cada `npm run validar` deixaria centenas de eventos em gc-dev (a
 * carga do 5.8 sozinha cria e apaga 500 itens) e a tela /logs viraria ruído.
 *
 * Critério: evento a partir de `desde` cujo registro NÃO existe mais — o que o
 * roteiro criou e apagou —, mais os de `entidade = 'validacao'` (a RPC de
 * teste). Evento de registro que continua existindo fica, seja de quem for;
 * por isso rodar duas camadas em paralelo não apaga o log real de ninguém.
 *
 * Precisa da chave de serviço: auditoria_eventos não tem policy de delete.
 */
export async function limparAuditoriaDoRoteiro(svc, desde) {
  // Paginado: o PostgREST corta em 1000 linhas (max-rows) sem avisar, e a
  // carga do 5.8 sozinha passa disso — na primeira rodada, a limpeza leu
  // exatamente 1000 e deixou o resto para trás.
  const recentes = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await svc
      .from('auditoria_eventos')
      .select('id, entidade, registro_id')
      .gte('em', desde)
      .order('id')
      .range(de, de + 999)
    if (error) return { apagados: 0, error }
    recentes.push(...data)
    if (data.length < 1000) break
  }

  const porEntidade = new Map()
  for (const e of recentes) {
    if (!e.registro_id) continue
    if (!porEntidade.has(e.entidade)) porEntidade.set(e.entidade, new Set())
    porEntidade.get(e.entidade).add(e.registro_id)
  }

  const aApagar = recentes.filter((e) => e.entidade === 'validacao').map((e) => e.id)
  for (const [entidade, ids] of porEntidade) {
    // Em lotes: a carga do 5.8 tem 500 itens, e 500 uuids num `in` estouram a URL.
    const lista = [...ids]
    const existentes = new Set()
    let falhou = false
    for (let i = 0; i < lista.length; i += 150) {
      const { data: vivos, error } = await svc.from(entidade).select('id').in('id', lista.slice(i, i + 150))
      if (error) { falhou = true; break }
      for (const v of vivos ?? []) existentes.add(v.id)
    }
    // Sem saber o que existe, não apaga nada daquela entidade.
    if (falhou) continue
    for (const e of recentes) {
      if (e.entidade === entidade && e.registro_id && !existentes.has(e.registro_id)) aApagar.push(e.id)
    }
  }

  // Erro de escrita (etapa B do 13.2): o roteiro provoca recusas de propósito
  // (perfil sem permissão, NF cancelada, CHECK), e o registro recusado em geral
  // continua existindo — o critério acima não o pega. Sai o evento de erro
  // gravado no período pelas sessões do roteiro: os perfis @teste.com e o
  // usuário da validação. Um erro real desse usuário durante a rodada sai
  // junto; é o preço de não deixar dezenas de erros de teste por rodada.
  const emailValidacao = process.env.VALIDACAO_EMAIL
  const filtroAutor = ['email.like.%@teste.com', emailValidacao ? `email.eq.${emailValidacao}` : null].filter(Boolean).join(',')
  const { data: autores } = await svc.from('profiles').select('id').or(filtroAutor)
  const idsAutores = (autores ?? []).map((a) => a.id)
  if (idsAutores.length > 0) {
    const { data: erros } = await svc
      .from('auditoria_eventos')
      .select('id')
      .gte('em', desde)
      .eq('resultado', 'erro')
      .eq('origem', 'sistema')
      .in('autor_id', idsAutores)
    const ja = new Set(aApagar)
    for (const e of erros ?? []) if (!ja.has(e.id)) aApagar.push(e.id)
  }

  let error = null
  for (let i = 0; i < aApagar.length; i += 200) {
    const r = await svc.from('auditoria_eventos').delete().in('id', aApagar.slice(i, i + 200))
    error ??= r.error
  }
  return { apagados: aApagar.length, error }
}
