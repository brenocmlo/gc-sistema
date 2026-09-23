-- ============================================================
-- SEED: 12 itens numa proposta rascunho de teste (gc-dev)
-- ============================================================
--   bash scripts/aplicar-seed.sh supabase/seed_itens.sql
--   bash scripts/aplicar-seed.sh --verificar supabase/seed_itens.sql
--
-- Fecha dois gargalos dos blocos 5.1 e 5.2:
--
-- 1. **A camada runtime nunca viu a tabela preenchida.** A proposta que o
--    `validacao-rotas.json` usava (`SEED-VENCIDA-001`) é `enviada` com ZERO
--    itens, então a aba caía no estado somente-leitura vazio e a tabela de
--    verdade nunca renderizava no servidor.
-- 2. **A tabela nunca foi vista com muitos itens.** 12 linhas é o bastante
--    para exercitar rolagem, rodapé e numeração com buraco. (O PDF de
--    referência da automação tem 16, não 12 — conferido por
--    `pdftotext -layout` em 2026-09-21; a contagem de 12 que o plano de
--    migração trazia estava errada e foi corrigida lá.)
--
-- A proposta hospedeira é `SEED-ITENS-001`, criada aqui e **em rascunho** de
-- propósito: rascunho é o único status em que a aba fica editável, e é essa
-- versão da tabela que precisava de cobertura.
--
-- Casos cobertos, espelhando o documento real:
--   - item com largura/altura (alimenta area_m2 GENERATED) e item sem
--   - unidade 'M2' e 'QTD' — as duas únicas que o CHECK aceita
--   - quantidade 1 e quantidade 13 (o PDF traz '01' e '13')
--   - numero com buraco na sequência (pula o 7), pra `proximoNumeroItem`
--     ter de fazer `maior + 1` e não `length + 1`
--   - um item com `numero` NULL, o caso de numeração não-inteira no documento
--     ("1.1"/"1A"), que convive no unique parcial
--   - descrição longa, que é o que estoura o layout da coluna
--
-- NÃO insere `valor_total` nem `area_m2`: são colunas GENERATED
-- (20260511151924 §8). O banco calcula; quem escrever aqui leva
-- `cannot insert a non-DEFAULT value into column`.
--
-- Marca com "[SEED-TESTE]" em observacao, igual aos outros seeds.
-- ============================================================

with
empresa as (
  select id from empresas order by created_at limit 1
),
obra as (
  select o.id, o.empresa_id
    from obras o
   where o.empresa_id = (select id from empresa)
   order by o.codigo_obra
   limit 1
),
proposta as (
  insert into propostas (
    empresa_id, obra_id, numero, descricao,
    data_emissao, data_validade, valor_total, desconto, status,
    pct_sinal, pct_fd, pct_entrega_material, pct_medicao_instalacao,
    condicoes_pagamento, observacao, historico
  )
  select
    obra.empresa_id,
    obra.id,
    'SEED-ITENS-001',
    'Proposta com 12 itens — cobertura da aba Itens (blocos 5.1/5.2)',
    current_date, current_date + 30, 0.00, 0.00, 'rascunho',
    0.30, 0.30, 0.20, 0.20,
    'Seed de itens.', '[SEED-TESTE] proposta hospedeira dos 12 itens',
    '[]'::jsonb
  from obra
  on conflict (empresa_id, numero) do nothing
  returning id, empresa_id, obra_id
),
alvo as (
  -- `on conflict do nothing` não devolve linha quando já existia: relê.
  select id, empresa_id, obra_id from proposta
  union all
  select p.id, p.empresa_id, p.obra_id
    from propostas p
   where p.numero = 'SEED-ITENS-001'
     and p.empresa_id = (select id from empresa)
     and not exists (select 1 from proposta)
),
dados as (
  select * from (values
    -- numero, tipo, linha, acabamento, localizacao, descricao,
    -- largura, altura, quantidade, unidade, valor_unit
    (1, 'Janela', 'Suprema', 'Branco', 'Fachada frontal',
     'Janela de correr 2 folhas com vidro temperado incolor 6mm',
     1.500, 1.200, 4.000, 'M2', 890.50),
    (2, 'Janela', 'Suprema', 'Preto', 'Fachada lateral',
     'Janela maxim-ar com tela mosquiteiro',
     0.800, 0.600, 6.000, 'M2', 645.00),
    (3, 'Porta', 'Gold', 'Bronze', 'Entrada social',
     'Porta de abrir 1 folha com bandeira fixa e fechadura de embutir',
     0.900, 2.100, 1.000, 'M2', 2340.75),
    (4, 'Porta', 'Gold', 'Bronze', 'Entrada de serviço',
     'Porta de correr 2 folhas',
     1.600, 2.100, 1.000, 'M2', 3180.00),
    (5, 'Guarda-corpo', 'Linha 30', 'Escovado', 'Sacada pavimento 2',
     'Guarda-corpo em vidro laminado 8+8mm com ferragens em inox escovado',
     null, null, 13.000, 'QTD', 1986.08),
    (6, 'Fechamento', 'ACM', 'Cinza', 'Marquise',
     'Fechamento em ACM 4mm, inclui estrutura de sustentação em tubo metalon',
     null, null, 1.000, 'QTD', 12450.00),
    -- Pula o 7 de propósito: `proximoNumeroItem` tem de devolver 13, não 12.
    (8, 'Espelho', null, 'Prata', 'Banheiro social',
     'Espelho bisotado com moldura em alumínio',
     0.600, 0.800, 2.000, 'M2', 420.00),
    (9, 'Box', 'Linha 25', 'Cromado', 'Banheiro suíte',
     'Box de correr em vidro temperado 8mm',
     1.200, 1.900, 1.000, 'M2', 1750.00),
    (10, 'Persiana', null, null, 'Dormitórios',
     'Persiana rolô blackout com acionamento manual',
     null, null, 5.000, 'QTD', 380.00),
    (11, 'Serviço', null, null, null,
     'Instalação e vedação — mão de obra especializada, inclui silicone estrutural e limpeza final da obra',
     null, null, 1.000, 'QTD', 8900.00),
    (12, 'Serviço', null, null, null,
     'Transporte e içamento de peças',
     null, null, 1.000, 'QTD', 2100.00),
    -- numero NULL: no documento real o item era "12.1". A coluna é integer,
    -- então o helper devolve null e guarda o original em observacao.
    (null, 'Aditivo', null, null, 'Fachada frontal',
     'Aditivo: troca de vidro incolor por refletivo (item 12.1 do documento)',
     1.500, 1.200, 1.000, 'M2', 310.00)
  ) as t(numero, tipo, linha, acabamento, localizacao, descricao,
         largura, altura, quantidade, unidade, valor_unit)
)
insert into itens (
  empresa_id, obra_id, proposta_id, contrato_id,
  numero, tipo, linha, acabamento, localizacao, descricao,
  largura, altura, quantidade, unidade, valor_unit, observacao
)
select
  a.empresa_id, a.obra_id, a.id, null,
  d.numero, d.tipo, d.linha, d.acabamento, d.localizacao, d.descricao,
  d.largura, d.altura, d.quantidade, d.unidade, d.valor_unit,
  '[SEED-TESTE]'
from alvo a
cross join dados d
where not exists (
  select 1 from itens i
   where i.proposta_id = a.id and i.observacao = '[SEED-TESTE]'
);

-- O valor_total de SEED-ITENS-001 NÃO é ajustado aqui: desde o bloco 5.6 o
-- trigger trg_itens_recalcula_pai o mantém igual à soma dos itens a cada
-- insert. (Antes do 5.6 este arquivo fazia o update à mão.)

-- ------------------------------------------------------------
-- SEED-DIVERGENTE-001 — proposta com itens cujo valor NÃO bate com a soma
-- ------------------------------------------------------------
-- Existe para a camada runtime provar que o aviso de divergência do bloco 5.6
-- aparece. Com o trigger, item nenhum produz divergência; ela só surge por
-- escrita direta em propostas.valor_total — n8n com service key, SQL à mão.
-- É exatamente isso que o update do fim simula.
with
empresa as (select id from empresas order by created_at limit 1),
obra as (
  select o.id, o.empresa_id from obras o
   where o.empresa_id = (select id from empresa) order by o.codigo_obra limit 1
),
proposta as (
  insert into propostas (empresa_id, obra_id, numero, descricao, data_emissao,
                         valor_total, desconto, status, observacao, historico)
  select obra.empresa_id, obra.id, 'SEED-DIVERGENTE-001',
         'Valor digitado fora do sistema, diferente da soma dos itens (bloco 5.6)',
         current_date, 0.00, 0.00, 'rascunho',
         '[SEED-TESTE] proposta com divergência de propósito', '[]'::jsonb
    from obra
  on conflict (empresa_id, numero) do nothing
  returning id, empresa_id, obra_id
),
alvo as (
  select id, empresa_id, obra_id from proposta
  union all
  select p.id, p.empresa_id, p.obra_id from propostas p
   where p.numero = 'SEED-DIVERGENTE-001'
     and p.empresa_id = (select id from empresa)
     and not exists (select 1 from proposta)
)
insert into itens (empresa_id, obra_id, proposta_id, numero, tipo, descricao,
                   quantidade, unidade, valor_unit, observacao)
select a.empresa_id, a.obra_id, a.id, d.numero, d.tipo, d.descricao,
       d.quantidade, 'QTD', d.valor_unit, '[SEED-TESTE]'
  from alvo a
 cross join (values
   (1, 'Janela', 'Janela de correr', 2.000, 1500.00),
   (2, 'Porta',  'Porta de abrir',   1.000, 2000.00)
 ) as d(numero, tipo, descricao, quantidade, valor_unit)
 where not exists (
   select 1 from itens i where i.proposta_id = a.id and i.observacao = '[SEED-TESTE]'
 );

-- Soma dos itens = 5.000,00 (o trigger acabou de gravar isso). Escrita direta
-- para 9.999,00: é a divergência que o aviso tem de mostrar.
update propostas set valor_total = 9999.00
 where numero = 'SEED-DIVERGENTE-001';

-- ============================================================
-- Verificação — deve voltar 1 linha: 12 itens, 1 sem numero
-- ============================================================
select
  p.numero                                      as proposta,
  p.status,
  count(i.id)                                   as itens,
  count(*) filter (where i.numero is null)      as sem_numero,
  count(*) filter (where i.unidade = 'M2')      as em_m2,
  count(*) filter (where i.unidade = 'QTD')     as em_qtd,
  count(*) filter (where i.area_m2 > 0)         as com_area_gerada,
  max(i.numero)                                 as maior_numero,
  round(sum(i.valor_total), 2)                  as soma_itens,
  round(p.valor_total, 2)                       as valor_da_proposta
from propostas p
join itens i on i.proposta_id = p.id
where p.numero = 'SEED-ITENS-001'
group by p.numero, p.status, p.valor_total;

-- ============================================================
-- CLEANUP (colar no SQL Editor; não roda automaticamente)
-- (vale para SEED-DIVERGENTE-001 também: troque o número abaixo)
-- ============================================================
-- Itens ANTES da proposta: a FK é `on delete set null (proposta_id)`, então
-- apagar a proposta deixaria os itens órfãos no banco.
-- delete from itens where observacao = '[SEED-TESTE]'
--   and proposta_id in (select id from propostas where numero = 'SEED-ITENS-001');
-- delete from propostas where numero = 'SEED-ITENS-001';
