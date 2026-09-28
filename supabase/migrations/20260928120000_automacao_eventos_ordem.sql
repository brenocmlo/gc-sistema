-- automacao_eventos.criado_em com now() dava a mesma hora a todos os eventos
-- de uma transação (ex.: o reprocesso, que muda status e etapa de uma vez), e
-- a linha do tempo saía fora de ordem. clock_timestamp() é a hora real de cada
-- insert.
alter table automacao_eventos alter column criado_em set default clock_timestamp();
