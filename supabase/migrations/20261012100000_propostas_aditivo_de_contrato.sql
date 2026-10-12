-- Aditivo como proposta ligada a um contrato (opção 1.a, Breno em 10/10).
-- Uma obra tem um contrato e várias propostas; a proposta que se declara
-- aditivo/complemento de um contrato aponta para ele.
--
-- Só a coluna. A FK está em 20261012110000_propostas_aditivo_fk.sql, separada
-- de propósito: com ela, propostas e contratos passam a ter duas relações e o
-- embed sem nome da FK quebra (PGRST201) — o código publicado precisa já usar
-- propostas!contratos_proposta_fk antes de a FK entrar.
alter table public.propostas
  add column if not exists contrato_aditivo_id uuid;

create index if not exists idx_propostas_contrato_aditivo
  on public.propostas (contrato_aditivo_id)
  where contrato_aditivo_id is not null;

comment on column public.propostas.contrato_aditivo_id is
  'Contrato do qual esta proposta é aditivo (mesma empresa e obra). Nulo = proposta comum.';
