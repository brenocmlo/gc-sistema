-- ============================================================
-- Recálculo do valor do pai: SECURITY DEFINER de volta (achado no 13.3)
-- ============================================================
-- A migration 017 (20260922140000) tirou `recalcular_valor_do_pai_do_item`
-- do caminho do RLS: como `security invoker`, a soma que o trigger faz a cada
-- item passa pela policy de `itens`, que chama `current_empresa_id()` para
-- CADA linha somada — custo quadrático (500 itens ≈ 125 mil chamadas). A 017
-- explica por que `security definer` é seguro aqui, e continua valendo.
--
-- A 031 (20260928100000, sem deadlock) recriou a função copiando o corpo da
-- 20260922130000, anterior à 017, e voltou a `security invoker` sem querer:
-- o cabeçalho dela diz que só a palavra da trava mudava. Desde então a
-- importação de 500 itens voltou a custar ~6 s no banco. O 13.1 tornou cada
-- chamada mais cara (as funções das policies passaram a olhar `ativo`), e a
-- camada escrita do 13.3 estourou o statement_timeout de 8 s duas vezes.
--
-- Medido em gc-dev em 2026-10-07, insert de 500 itens como admin, numa
-- transação desfeita: 6,1 s com o trigger como invoker; 0,2 s sem o trigger;
-- 0,4 s como dono. Só muda o privilégio; o corpo é o da 031.
-- ============================================================

begin;

alter function recalcular_valor_do_pai_do_item() security definer;

-- Função de trigger não é API.
revoke all on function recalcular_valor_do_pai_do_item() from public, anon, authenticated;

commit;
