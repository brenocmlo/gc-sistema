-- ============================================================
-- 027_execucao_nomes_checks.sql
-- ============================================================
-- Fechamento da sprint 7 — os quatro CHECKs da cascata da execução foram
-- criados inline na migration 001 (20260424121550), sem nome. O Postgres deu
-- nome automático (execucao_check, execucao_check1, 2, 3), e o
-- mensagemDeErroExecucao de src/lib/execucao.ts procura
-- execucao_{fab,ent,inst,med}_qtd_check — nomes que o banco nunca teve. A
-- camada escrita do fechamento pegou: o erro chegava cru à tela.
--
-- Renomeia pela DEFINIÇÃO, não pelo sufixo numérico, que depende da ordem de
-- criação. Idempotente: CHECK que já tem o nome certo não entra no laço.
-- Não mexe em dado nem na regra, só no nome.
-- ============================================================

begin;

do $$
declare
  c record;
  novo text;
begin
  for c in
    select conname, pg_get_constraintdef(oid) as def
    from pg_constraint
    where conrelid = 'public.execucao'::regclass
      and contype = 'c'
      and conname not like '%\_qtd\_check'
  loop
    novo := case
      when c.def like '%fab_qtd <= quantidade_total%' then 'execucao_fab_qtd_check'
      when c.def like '%ent_qtd <= fab_qtd%'          then 'execucao_ent_qtd_check'
      when c.def like '%inst_qtd <= ent_qtd%'         then 'execucao_inst_qtd_check'
      when c.def like '%med_qtd <= inst_qtd%'         then 'execucao_med_qtd_check'
    end;
    if novo is not null then
      execute format('alter table public.execucao rename constraint %I to %I', c.conname, novo);
    end if;
  end loop;
end $$;

commit;
