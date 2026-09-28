-- ============================================================
-- 030_execucao_medicoes.sql
-- ============================================================
-- Bloco 8.4 — relatório de medição por obra. O relatório pede o "valor
-- medido no período e acumulado", e a execução só guarda o acumulado
-- (`med_qtd`) e a data da última mudança. Sem histórico, "medido em
-- setembro" não tem como ser calculado.
--
-- Esta tabela é o histórico: uma linha cada vez que `med_qtd` muda (trigger),
-- com a quantidade antes e depois. Medido no período = soma de
-- (qtd_nova - qtd_anterior) com `data` no período; acumulado numa data =
-- `med_qtd` de hoje menos as mudanças depois dela.
--
-- Carga inicial: cada execução já medida entra com uma linha de 0 até o
-- `med_qtd` atual, na data da última atualização da medição. Quem mediu em
-- duas vezes antes desta migration aparece como uma medição só, naquela data.
--
-- Só leitura pela aplicação (RLS por empresa); escrita só pelo trigger.
-- A auditoria (13.2) também vê a mudança, mas só o admin lê a auditoria, e
-- um log de auditoria não deve ser fonte de valor que vai para o cliente.
-- ============================================================

begin;

create table if not exists execucao_medicoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  execucao_id uuid not null references execucao(id) on delete cascade,
  data date not null default current_date,
  qtd_anterior numeric(10,3) not null,
  qtd_nova numeric(10,3) not null,
  criado_por uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists idx_execucao_medicoes_execucao_data on execucao_medicoes(execucao_id, data);
create index if not exists idx_execucao_medicoes_empresa on execucao_medicoes(empresa_id);

alter table execucao_medicoes enable row level security;

drop policy if exists "Medições: ver da empresa" on execucao_medicoes;
create policy "Medições: ver da empresa" on execucao_medicoes
  for select using (empresa_id = current_empresa_id());

-- security definer: grava ignorando a RLS da tabela, que não tem policy de
-- escrita — ninguém insere pela API.
create or replace function execucao_registra_medicao()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  anterior numeric := case when tg_op = 'INSERT' then 0 else coalesce(old.med_qtd, 0) end;
begin
  if coalesce(new.med_qtd, 0) is distinct from anterior then
    insert into execucao_medicoes (empresa_id, execucao_id, qtd_anterior, qtd_nova)
    values (new.empresa_id, new.id, anterior, coalesce(new.med_qtd, 0));
  end if;
  return null;
end;
$$;

drop trigger if exists trg_execucao_registra_medicao on execucao;
create trigger trg_execucao_registra_medicao
  after insert or update of med_qtd on execucao
  for each row execute function execucao_registra_medicao();

-- Carga inicial (idempotente: só execução que ainda não tem histórico).
insert into execucao_medicoes (empresa_id, execucao_id, data, qtd_anterior, qtd_nova, criado_por, created_at)
select e.empresa_id, e.id, coalesce(e.med_data_atualizacao, e.created_at::date, current_date), 0, e.med_qtd, null, now()
from execucao e
where e.med_qtd > 0
  and not exists (select 1 from execucao_medicoes m where m.execucao_id = e.id);

commit;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- drop trigger if exists trg_execucao_registra_medicao on execucao;
-- drop function if exists execucao_registra_medicao();
-- drop table if exists execucao_medicoes;
