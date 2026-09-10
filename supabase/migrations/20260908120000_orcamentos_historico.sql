-- ============================================================
-- 013_orcamentos_historico.sql
-- ============================================================
-- Mesma coluna de histórico que propostas ganhou na 011, agora em
-- orcamentos — a aba "Histórico" da tela de detalhe de orçamento
-- existia desde o bloco 2.x mostrando "Histórico virá em breve".
--
-- Uniformiza de propósito: o formato de entrada é idêntico ao de
-- propostas (ver src/lib/historico.ts, genérico no tipo de status),
-- então as duas telas leem e escrevem a mesma forma.
--
-- Aditiva e reversível: `alter table orcamentos drop column historico;`
-- Em transação única, como as 008-012.
-- ============================================================

begin;

alter table orcamentos
  add column if not exists historico jsonb not null default '[]'::jsonb;

comment on column orcamentos.historico is
  'Append-only: uma entrada por transição de status. Mesmo formato de propostas.historico.';

-- Garante lista: o app faz append, e um objeto solto quebraria a leitura
-- em silêncio.
alter table orcamentos
  drop constraint if exists orcamentos_historico_lista;

alter table orcamentos
  add constraint orcamentos_historico_lista
  check (jsonb_typeof(historico) = 'array');

commit;
