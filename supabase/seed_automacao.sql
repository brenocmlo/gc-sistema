-- ============================================================
-- SEED: um documento da automação com andamento completo (gc-dev)
-- ============================================================
--   bash scripts/banco/aplicar-seed.sh supabase/seed_automacao.sql
--
-- Sem documento com obra e sem documento com etapa, duas queries da camada
-- dados saíam "query válida, mas não exercitada" (fechamento da sprint 9):
--   - documentos_processamento: colunas de revisão e opções de vínculo da obra
--   - automacao_eventos: etapa do documento e andamento em ordem
--
-- SEED-DOC-001: contrato da obra do SEED-CT-001, APROVADO, revisado pelo
-- admin da empresa, que passa por NA_FILA → LEITURA → GRAVANDO → CONCLUIDO. Os
-- eventos vêm do próprio trigger (trg_documentos_evento), um por mudança, em
-- ordem — é a ordem que a query confere.
--
-- Depois os eventos e o documento são levados para 10 dias atrás: a faixa de
-- "automação parada" olha os eventos recentes, e um CONCLUIDO de agora
-- apagaria a faixa que o passo do navegador provoca. Nenhum evento é de erro:
-- o seed não pode parar a automação de ninguém.
--
-- APROVADO, e não REVISAO_HUMANA, para não entrar no filtro de revisão que o
-- navegador abre. Idempotente pelo numero_contrato + motivo_revisao.
-- ============================================================

do $$
declare
  v_ct   record;
  v_rev  uuid;
  v_doc  uuid;
  v_base timestamptz := now() - interval '10 days';
begin
  if exists (select 1 from documentos_processamento
              where numero_contrato = 'SEED-DOC-001' and motivo_revisao like '[SEED-TESTE]%') then
    raise notice 'SEED-DOC-001 já existe; nada a fazer';
    return;
  end if;

  select c.empresa_id, c.obra_id into v_ct
    from contratos c where c.numero = 'SEED-CT-001' and c.observacao like '[SEED-TESTE]%';
  if v_ct is null then
    raise exception 'SEED-CT-001 ausente: aplique supabase/seed_contratos.sql antes';
  end if;

  select id into v_rev from profiles
   where empresa_id = v_ct.empresa_id and perfil = 'admin' and ativo
   order by created_at limit 1;

  insert into documentos_processamento (empresa_id, tipo_documento, arquivo_url, status, obra_id,
                                        numero_contrato, motivo_revisao, etapa)
  values (v_ct.empresa_id, 'CONTRATO', 'seed://SEED-DOC-001.pdf', 'PENDENTE', v_ct.obra_id,
          'SEED-DOC-001', '[SEED-TESTE] documento da automação (plano de validação)', 'NA_FILA')
  returning id into v_doc;

  update documentos_processamento set etapa = 'LEITURA' where id = v_doc;
  update documentos_processamento set etapa = 'GRAVANDO' where id = v_doc;
  update documentos_processamento
     set etapa = 'CONCLUIDO', status = 'APROVADO', revisado_por = v_rev, revisado_em = now()
   where id = v_doc;

  -- 10 dias atrás, mantendo a ordem e o espaçamento de 1 minuto entre eventos.
  update automacao_eventos e
     set criado_em = v_base + (o.n * interval '1 minute')
    from (select id, row_number() over (order by criado_em, id) as n
            from automacao_eventos where documento_id = v_doc) o
   where e.id = o.id;
  update documentos_processamento
     set created_at = v_base, etapa_em = v_base + interval '5 minutes', revisado_em = v_base + interval '6 minutes'
   where id = v_doc;
end $$;

-- ============================================================
-- Verificação — 1 documento com obra e revisor, e os eventos em ordem,
-- terminando em CONCLUIDO, nenhum de erro
-- ============================================================
select d.numero_contrato, d.status, d.etapa, o.codigo_obra, p.perfil as revisor, d.created_at::date
  from documentos_processamento d
  left join obras o on o.id = d.obra_id
  left join profiles p on p.id = d.revisado_por
 where d.numero_contrato = 'SEED-DOC-001';

select e.etapa, e.nivel, e.mensagem, e.criado_em
  from automacao_eventos e
  join documentos_processamento d on d.id = e.documento_id
 where d.numero_contrato = 'SEED-DOC-001'
 order by e.criado_em;

-- ============================================================
-- CLEANUP (colar no SQL Editor; não roda automaticamente)
-- ============================================================
-- delete from documentos_processamento where numero_contrato = 'SEED-DOC-001' and motivo_revisao like '[SEED-TESTE]%';
-- (os eventos saem em cascata)
