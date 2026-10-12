-- FK do aditivo (ver 20261012100000). Aplicar SÓ depois que o código que
-- nomeia a FK nos embeds (propostas!contratos_proposta_fk) estiver publicado:
-- com duas relações entre propostas e contratos, embed sem nome dá PGRST201.
--
-- Composta como a contratos_proposta_fk: o contrato é da mesma empresa e da
-- mesma obra. Apagar o contrato só solta a ligação.
alter table public.propostas
  drop constraint if exists propostas_contrato_aditivo_fk;

alter table public.propostas
  add constraint propostas_contrato_aditivo_fk
  foreign key (contrato_aditivo_id, empresa_id, obra_id)
  references public.contratos (id, empresa_id, obra_id)
  on delete set null (contrato_aditivo_id);

