-- Automação: conferência do que o bot criou (Breno, 25/09 — "aceitar ou não").
--
-- A leitura automática grava proposta ou contrato sozinha. Uma pessoa confere
-- depois: Aceitar (a leitura está certa) ou Não aceitar (o que o bot criou é
-- apagado e o documento volta para revisão). O resultado comercial da proposta
-- (aprovada/rejeitada) é outra coisa e continua no diálogo de status dela.
--
--   null      → não se aplica (documento antigo, descartado, ou resolvido à mão)
--   pendente  → o bot criou e ninguém conferiu ainda
--   aceita    → conferido e mantido
--   recusada  → conferido e desfeito
--
-- Quem conferiu e quando reusa revisado_por / revisado_em (20260925100000).

alter table documentos_processamento
  add column if not exists conferencia text
    check (conferencia is null or conferencia in ('pendente', 'aceita', 'recusada'));

comment on column documentos_processamento.conferencia is
  'Conferência humana do que a automação criou: pendente, aceita ou recusada. Nulo = não se aplica.';

create index if not exists idx_documentos_processamento_conferencia
  on documentos_processamento (empresa_id, conferencia)
  where conferencia = 'pendente';
