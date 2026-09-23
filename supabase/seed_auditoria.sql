-- ============================================================
-- SEED: dois eventos fixos de auditoria (gc-dev) — bloco 13.2
-- ============================================================
--   bash scripts/aplicar-seed.sh supabase/seed_auditoria.sql
--
-- A camada de escrita limpa os eventos que gera, então sem este seed a tela
-- /logs só teria linha por acaso — e as camadas runtime, dados e navegador
-- precisam de linha certa pra provar o render, o filtro e o <details>.
--
-- Os dois casos que a tela tem de saber mostrar:
--   1. ERRO da automação, com mensagem e sem autor profile
--      (mensagem começa por 'SEED-AUDITORIA-ERRO').
--   2. SUCESSO de mudança de status com diff campo a campo, apontando pra
--      SEED-VENCIDA-001 (autor_descricao = 'SEED-AUDITORIA').
--
-- Idempotente: cada insert só roda se o evento ainda não existir. Nunca é
-- atualizado — auditoria_eventos recusa update por trigger.
-- ============================================================

with empresa as (
  select id from empresas order by created_at limit 1
)
insert into auditoria_eventos (
  empresa_id, origem, entidade, referencia, acao, resultado, mensagem, autor_descricao, detalhe
)
select
  (select id from empresa),
  'automacao',
  'documentos_processamento',
  'SEED-AUDITORIA-DOC',
  'processar_documento',
  'erro',
  'SEED-AUDITORIA-ERRO: documento ilegível, pedido de reenvio enviado ao cliente',
  'telegram:seed',
  '{"etapa": "extracao", "exemplo": true}'::jsonb
where not exists (
  select 1 from auditoria_eventos where mensagem like 'SEED-AUDITORIA-ERRO%'
);

with empresa as (
  select id from empresas order by created_at limit 1
)
insert into auditoria_eventos (
  empresa_id, origem, entidade, registro_id, referencia, acao, resultado, autor_descricao, detalhe
)
select
  (select id from empresa),
  'sistema',
  'propostas',
  (select id from propostas where numero = 'SEED-VENCIDA-001' limit 1),
  'SEED-VENCIDA-001',
  'status',
  'sucesso',
  'SEED-AUDITORIA',
  '{"campos": {"status": {"de": "rascunho", "para": "enviada"}, "desconto": {"de": 0, "para": 5000}}}'::jsonb
where not exists (
  select 1 from auditoria_eventos where autor_descricao = 'SEED-AUDITORIA'
);

select origem, entidade, referencia, acao, resultado, coalesce(mensagem, autor_descricao) as marca
  from auditoria_eventos
 where mensagem like 'SEED-AUDITORIA%' or autor_descricao = 'SEED-AUDITORIA'
 order by id;
