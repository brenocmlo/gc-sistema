-- Automação, Fase 7: ações de revisão na tela /documentos.
--
-- Um documento em revisão precisava de três saídas pela tela: reprocessar
-- (volta a PENDENTE e o n8n lê de novo), vincular a uma proposta/contrato que
-- a equipe fez à mão (vira APROVADO) e DESCARTAR — ex.: PDF errado, duplicado,
-- spam. Descartar sem apagar mantém o rastro do que chegou; por isso o status
-- novo, e não um delete.
--
-- A decisão 6 dizia "só acrescente valor ao CHECK se provar que precisa": aqui
-- precisa. Os quatro valores antigos continuam valendo; nada no n8n escreve
-- DESCARTADO.

begin;

alter table documentos_processamento
  drop constraint if exists documentos_processamento_status_check,
  add constraint documentos_processamento_status_check
    check (status in ('PENDENTE', 'ERRO_VALIDACAO', 'REVISAO_HUMANA', 'APROVADO', 'DESCARTADO'));

alter table documentos_processamento
  add column if not exists revisado_por uuid references profiles(id),
  add column if not exists revisado_em timestamptz;

comment on column documentos_processamento.revisado_por is
  'Quem resolveu o documento pela tela (vincular ou descartar). Nulo quando a automação resolveu sozinha.';
comment on column documentos_processamento.revisado_em is
  'Quando a revisão pela tela aconteceu.';

commit;
