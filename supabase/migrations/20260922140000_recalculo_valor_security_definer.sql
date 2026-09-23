-- ============================================================
-- 017_recalculo_valor_security_definer.sql
-- ============================================================
-- Tira o trigger do bloco 5.6 do caminho do RLS.
--
-- O PROBLEMA, medido em gc-dev em 2026-09-22: importar 500 itens numa
-- proposta levava 5,8 s pelo PostgREST. O mesmo insert, direto no banco (sem
-- RLS), levava 0,2 s.
--
-- Por quê: o trigger era `security invoker`. A soma que ele faz a cada item
-- (`select sum(valor_total) from itens where proposta_id = ...`) passava pela
-- policy "Itens: tenant isolation", que chama `current_empresa_id()` — uma
-- consulta a `profiles` — PARA CADA LINHA SOMADA. 500 inserções × até 500
-- linhas somadas ≈ 125 mil consultas. O custo crescia com o quadrado do número
-- de itens.
--
-- A CORREÇÃO: `security definer`. A função passa a rodar com o dono (que não
-- está sujeito a RLS), então a soma e o update do pai não pagam policy.
--
-- Por que é seguro:
--   * o trigger só dispara depois que o RLS de `itens` JÁ autorizou a escrita
--     do item — quem não pode escrever o item nem chega aqui;
--   * ele só escreve no PAI daquele item, e o pai é da mesma empresa pela FK
--     composta `(proposta_id, empresa_id, obra_id)` / `(contrato_id, ...)`;
--   * o que ele escreve é derivado (a soma), não vem do usuário;
--   * `search_path` fixo, como exige toda função `security definer`.
--
-- Não muda nenhuma regra: as três escolhas das migrations 20260922120000 e
-- 20260922130000 (sem backfill, último item não zera, soma abaixo do desconto
-- não sincroniza) e a trava do pai continuam iguais. Só muda o privilégio.
-- ============================================================

begin;

alter function recalcular_valor_do_pai_do_item() security definer;
alter function recalcular_valor_do_pai_do_item() set search_path = public, pg_temp;

-- Ninguém deve chamar a função direto: ela só faz sentido como trigger.
revoke execute on function recalcular_valor_do_pai_do_item() from public, anon, authenticated;

do $$
begin
  if not (select prosecdef from pg_proc where proname = 'recalcular_valor_do_pai_do_item') then
    raise exception 'recalcular_valor_do_pai_do_item continua security invoker';
  end if;
end $$;

commit;
