-- ============================================================
-- SEED: execução em estágios diferentes (gc-dev)
-- ============================================================
--   bash scripts/aplicar-seed.sh supabase/seed_execucao.sql
--
-- Bloco 7.2. A listagem de execução só mostra algo com itens de contrato que
-- tenham execução, e gc-dev não tinha nenhuma. Este seed cria um contrato
-- SEED-CT-EXEC (ativo, na primeira obra, como os SEED-CT-*) com 5 itens:
--
--   1 Janela de correr   10 un  concluída nas 4 etapas, previsão vencida (Equipe A)
--   2 Porta pivotante     6 un  fab 6, ent 3             (Transportadora Silva)
--   3 Guarda-corpo       20 un  fab 5, previsão da fabricação vencida (Serralheria Norte)
--   4 Box de vidro        4 un  execução zerada
--   5 Espelho             2 un  SEM execução — o botão "Criar execução" do 7.2
--   6 Fachada            10 un  DUAS execuções (7.4): Torre A 6 e Torre B 4,
--                               zeradas — o agrupamento por item da listagem
--
-- As quantidades entram por UPDATE, e não no INSERT, para o trigger
-- execucao_preenche_datas preencher início, atualização e fim como na tela.
-- Idempotente: o contrato tem unique (empresa_id, numero), os itens e as
-- execuções só entram se ainda não existirem.
-- Marca com "[SEED-TESTE]" em observacao, igual aos outros seeds.
-- ============================================================

with
empresa as (select id from empresas order by created_at limit 1),
obra as (
  select o.id, o.empresa_id from obras o
   where o.empresa_id = (select id from empresa)
   order by o.codigo_obra limit 1
)
insert into contratos (empresa_id, obra_id, numero, descricao, data_assinatura,
                       valor_total, desconto, status, observacao, historico)
select obra.empresa_id, obra.id, 'SEED-CT-EXEC', 'Contrato com execução (sprint 7)',
       current_date - 30, 0, 0, 'ativo', '[SEED-TESTE] execução (bloco 7.2)', '[]'::jsonb
  from obra
on conflict (empresa_id, numero) do nothing;

with alvo as (
  select c.id, c.empresa_id, c.obra_id from contratos c
   where c.numero = 'SEED-CT-EXEC' and c.observacao like '[SEED-TESTE]%'
)
insert into itens (empresa_id, obra_id, contrato_id, numero, tipo, descricao,
                   quantidade, unidade, valor_unit, observacao)
select a.empresa_id, a.obra_id, a.id, d.numero, d.tipo, d.descricao,
       d.quantidade, 'QTD', d.valor_unit, '[SEED-TESTE]'
  from alvo a
 cross join (values
   (1, 'Janela',       'Janela de correr', 10.000,  900.00),
   (2, 'Porta',        'Porta pivotante',   6.000, 3200.00),
   (3, 'Guarda-corpo', 'Guarda-corpo',     20.000,  450.00),
   (4, 'Box',          'Box de vidro',      4.000, 1100.00),
   (5, 'Espelho',      'Espelho',           2.000,  380.00),
   (6, 'Fachada',      'Fachada de vidro', 10.000,  700.00)
 ) as d(numero, tipo, descricao, quantidade, valor_unit)
 where not exists (
   select 1 from itens i where i.contrato_id = a.id and i.numero = d.numero
 );

-- Execuções dos itens 1 a 4 (o 5 fica sem, de propósito).
insert into execucao (empresa_id, item_id, sequencial, quantidade_total)
select i.empresa_id, i.id, 1, 0
  from itens i
  join contratos c on c.id = i.contrato_id
 where c.numero = 'SEED-CT-EXEC' and i.numero in (1, 2, 3, 4)
   and not exists (select 1 from execucao e where e.item_id = i.id);

-- Item 6: duas execuções com quantidade própria. Precisa da migration
-- 20260924110000, que faz o INSERT respeitar a quantidade enviada.
insert into execucao (empresa_id, item_id, sequencial, quantidade_total, localizacao)
select i.empresa_id, i.id, d.seq, d.qtd, d.loc
  from itens i
  join contratos c on c.id = i.contrato_id
 cross join (values (1, 6.000, 'Torre A'), (2, 4.000, 'Torre B')) as d(seq, qtd, loc)
 where c.numero = 'SEED-CT-EXEC' and i.numero = 6
   and not exists (select 1 from execucao e where e.item_id = i.id);

-- Avanço de cada uma. Só mexe na execução ainda zerada, para reaplicar o seed
-- não desfazer o que a validação ou alguém apontou depois.
update execucao e
   set fab_qtd = d.fab, ent_qtd = d.ent, inst_qtd = d.inst, med_qtd = d.med,
       fab_responsavel = d.rfab, ent_responsavel = d.rent,
       inst_responsavel = d.rinst, med_responsavel = d.rmed
  from itens i
  join contratos c on c.id = i.contrato_id
  join (values
    (1, 10.000, 10.000, 10.000, 10.000, 'Equipe A', 'Equipe A', 'Equipe A', 'Equipe A'),
    (2,  6.000,  3.000,  0.000,  0.000, 'Equipe A', 'Transportadora Silva', null, null),
    (3,  5.000,  0.000,  0.000,  0.000, 'Serralheria Norte', null, null, null)
  ) as d(numero, fab, ent, inst, med, rfab, rent, rinst, rmed) on d.numero = i.numero
 where e.item_id = i.id
   and c.numero = 'SEED-CT-EXEC'
   and e.fab_qtd = 0;

-- Previsões (bloco 7.5). Só datas no PASSADO, para o seed não "vencer"
-- sozinho com os dias: a do Guarda-corpo (fabricação a 25%) é atraso; a da
-- Janela (concluída) prova que etapa concluída não atrasa. Previsão futura,
-- para o painel de próximos vencimentos, é montada e desfeita pela camada
-- navegador. Só grava onde ainda não há previsão.
update execucao e
   set fab_previsao_fim = coalesce(e.fab_previsao_fim, d.fab),
       med_previsao_fim = coalesce(e.med_previsao_fim, d.med)
  from itens i
  join contratos c on c.id = i.contrato_id
  join (values
    (1, null::date, current_date - 10),
    (3, current_date - 5, null::date)
  ) as d(numero, fab, med) on d.numero = i.numero
 where e.item_id = i.id
   and c.numero = 'SEED-CT-EXEC';

-- ============================================================
-- Verificação — deve voltar 7 linhas (o Espelho sem execução, a Fachada com 2)
-- ============================================================
select i.numero, i.descricao, i.quantidade, e.sequencial, e.quantidade_total, e.localizacao, e.fab_qtd, e.ent_qtd, e.inst_qtd, e.med_qtd,
       e.fab_status, e.med_status, e.fab_data_inicio, e.fab_previsao_fim, e.med_previsao_fim
  from itens i
  join contratos c on c.id = i.contrato_id
  left join execucao e on e.item_id = i.id
 where c.numero = 'SEED-CT-EXEC'
 order by i.numero, e.sequencial;

-- ============================================================
-- CLEANUP (colar no SQL Editor; não roda automaticamente)
-- ============================================================
-- delete from execucao where item_id in (select i.id from itens i join contratos c on c.id = i.contrato_id where c.numero = 'SEED-CT-EXEC');
-- delete from itens where contrato_id in (select id from contratos where numero = 'SEED-CT-EXEC');
-- delete from contratos where numero = 'SEED-CT-EXEC' and observacao like '[SEED-TESTE]%';
