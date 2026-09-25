-- ============================================================
-- 028_execucao_data_fim_total.sql
-- ============================================================
-- Fechamento da sprint 7 — pendência registrada no 7.4. O trigger
-- execucao_preenche_datas (migration 001) já dispara em update de
-- quantidade_total, mas só recalculava *_data_fim quando a quantidade da
-- ETAPA mudava. Aumentar o total de uma execução concluída deixava o status
-- GENERATED em "andamento" e a data de fim preenchida: dado contraditório.
--
-- Agora o fim é recalculado quando a quantidade da etapa OU o total muda.
-- Data de atualização e de início continuam presas à quantidade da etapa:
-- mudar o total não é apontamento.
--
-- Não corrige linhas antigas: em gc-dev nenhuma execução está com data_fim
-- preenchida e etapa abaixo do total (conferido no fechamento).
-- ============================================================

begin;

create or replace function execucao_preenche_datas()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- FABRICAÇÃO
  if (new.fab_qtd is distinct from old.fab_qtd) then
    new.fab_data_atualizacao := current_date;
    if old.fab_qtd = 0 and new.fab_qtd > 0 then
      new.fab_data_inicio := coalesce(old.fab_data_inicio, current_date);
    end if;
  end if;
  if (new.fab_qtd is distinct from old.fab_qtd)
     or (new.quantidade_total is distinct from old.quantidade_total) then
    if new.fab_qtd >= new.quantidade_total and new.quantidade_total > 0 then
      new.fab_data_fim := coalesce(old.fab_data_fim, current_date);
    elsif new.fab_qtd < new.quantidade_total then
      new.fab_data_fim := null;  -- voltou pra andamento
    end if;
  end if;

  -- ENTREGA
  if (new.ent_qtd is distinct from old.ent_qtd) then
    new.ent_data_atualizacao := current_date;
    if old.ent_qtd = 0 and new.ent_qtd > 0 then
      new.ent_data_inicio := coalesce(old.ent_data_inicio, current_date);
    end if;
  end if;
  if (new.ent_qtd is distinct from old.ent_qtd)
     or (new.quantidade_total is distinct from old.quantidade_total) then
    if new.ent_qtd >= new.quantidade_total and new.quantidade_total > 0 then
      new.ent_data_fim := coalesce(old.ent_data_fim, current_date);
    elsif new.ent_qtd < new.quantidade_total then
      new.ent_data_fim := null;
    end if;
  end if;

  -- INSTALAÇÃO
  if (new.inst_qtd is distinct from old.inst_qtd) then
    new.inst_data_atualizacao := current_date;
    if old.inst_qtd = 0 and new.inst_qtd > 0 then
      new.inst_data_inicio := coalesce(old.inst_data_inicio, current_date);
    end if;
  end if;
  if (new.inst_qtd is distinct from old.inst_qtd)
     or (new.quantidade_total is distinct from old.quantidade_total) then
    if new.inst_qtd >= new.quantidade_total and new.quantidade_total > 0 then
      new.inst_data_fim := coalesce(old.inst_data_fim, current_date);
    elsif new.inst_qtd < new.quantidade_total then
      new.inst_data_fim := null;
    end if;
  end if;

  -- MEDIÇÃO
  if (new.med_qtd is distinct from old.med_qtd) then
    new.med_data_atualizacao := current_date;
    if old.med_qtd = 0 and new.med_qtd > 0 then
      new.med_data_inicio := coalesce(old.med_data_inicio, current_date);
    end if;
  end if;
  if (new.med_qtd is distinct from old.med_qtd)
     or (new.quantidade_total is distinct from old.quantidade_total) then
    if new.med_qtd >= new.quantidade_total and new.quantidade_total > 0 then
      new.med_data_fim := coalesce(old.med_data_fim, current_date);
    elsif new.med_qtd < new.quantidade_total then
      new.med_data_fim := null;
    end if;
  end if;

  return new;
end;
$$;

commit;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Reaplicar execucao_preenche_datas de 20260424121550_initial.sql.
