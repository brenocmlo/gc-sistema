-- ============================================================
-- 011_propostas_historico.sql
-- ============================================================
-- Histórico de transições de status das propostas, para o bloco 4.6
-- ("Registrar a transição no campo jsonb de histórico").
--
-- Por que jsonb numa coluna, e não tabela própria: o histórico aqui é
-- append-only, sempre lido junto com a proposta e nunca consultado de
-- forma independente — o mesmo desenho já usado em `anexos`. Tabela
-- separada só se um dia for preciso filtrar/agregar por transição.
--
-- Formato de cada entrada (o app monta em src/lib/propostas.ts):
--   {
--     "de": "rascunho", "para": "enviada",
--     "em": "2026-09-05T18:00:00.000Z",
--     "por": "<uuid do profile>",
--     "motivo_rejeicao": null, "detalhe_rejeicao": null
--   }
--
-- Aditiva e reversível: `alter table propostas drop column historico;`
-- Tudo em transação única, como as migrations 008-010.
-- ============================================================

begin;

alter table propostas
  add column if not exists historico jsonb not null default '[]'::jsonb;

comment on column propostas.historico is
  'Append-only: uma entrada por transição de status. Ver bloco 4.6.';

-- Garante que é sempre uma lista — o app faz append e um objeto solto
-- quebraria a leitura silenciosamente.
alter table propostas
  drop constraint if exists propostas_historico_lista;

alter table propostas
  add constraint propostas_historico_lista
  check (jsonb_typeof(historico) = 'array');

commit;
