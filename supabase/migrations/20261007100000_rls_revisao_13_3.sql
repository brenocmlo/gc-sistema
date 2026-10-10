-- ============================================================
-- 13.3 Revisão de RLS ponta a ponta: as policies frouxas
-- ============================================================
-- Achados da revisão de 2026-10-07 em gc-dev. Os quatro foram provados pela
-- API antes desta migration: a tela barrava, o banco não.
--
-- 1. Funções SECURITY DEFINER expostas na API. `atualizar_status_nf_by_id` e
--    `atualizar_status_parcela_by_id` recebem um id e gravam o status como
--    dono da função, sem RLS. Qualquer um com a chave pública (anon) podia
--    chamá-las por /rpc, sobre NF e parcela de qualquer empresa. Quem precisa
--    delas são os triggers de pagamento, NF e parcela, que também são SECURITY
--    DEFINER e por isso não dependem do grant de quem escreve.
--
-- 2. Dados financeiros abertos a todos os perfis. NF, pagamento, FD, acordo e
--    parcela tinham select "tenant isolation": produção e medição, que não
--    entram em /financeiro nem em /fd, liam tudo pela API. Agora:
--      - NF, pagamento, acordo e parcela: admin, financeiro, visualizador e
--        comercial. O comercial entra porque a proposta e o contrato mostram o
--        faturado e o recebido pelas views propostas_financeiro e
--        contratos_financeiro, que são security_invoker.
--      - FD: admin, financeiro e visualizador (as telas de /fd).
--
-- 3. Bucket notas-fiscais: qualquer perfil lia o XML e o PDF da NF. Fica com
--    os perfis das telas de NF (admin, financeiro, visualizador), que geram o
--    link assinado com a própria sessão.
--
-- 4. Comprovante de pagamento no bucket anexos (pasta <empresa>/<x>/pagamentos):
--    o select do bucket era da empresa toda. O comprovante fica com os perfis
--    que leem pagamento; o resto do bucket não muda.
-- ============================================================

begin;

-- 1. RPC sem dono ---------------------------------------------------------
revoke all on function atualizar_status_nf_by_id(uuid) from public, anon, authenticated;
revoke all on function atualizar_status_parcela_by_id(uuid) from public, anon, authenticated;

-- 2. Select financeiro por perfil ------------------------------------------
drop policy if exists "NFs: tenant isolation" on notas_fiscais;
create policy "NFs: ver (financeiro, comercial, visualizador)" on notas_fiscais
  for select using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'financeiro', 'visualizador', 'comercial'])
  );

drop policy if exists "Pagamentos: tenant isolation" on pagamentos;
create policy "Pagamentos: ver (financeiro, comercial, visualizador)" on pagamentos
  for select using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'financeiro', 'visualizador', 'comercial'])
  );

drop policy if exists "Acordos: tenant isolation" on acordos_pagamento;
create policy "Acordos: ver (financeiro, comercial, visualizador)" on acordos_pagamento
  for select using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'financeiro', 'visualizador', 'comercial'])
  );

drop policy if exists "Parcelas: tenant isolation" on acordo_parcelas;
create policy "Parcelas: ver (financeiro, comercial, visualizador)" on acordo_parcelas
  for select using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'financeiro', 'visualizador', 'comercial'])
  );

drop policy if exists "FD: tenant isolation" on fd;
create policy "FD: ver (financeiro, visualizador)" on fd
  for select using (
    empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'financeiro', 'visualizador'])
  );

-- 3. Bucket notas-fiscais ----------------------------------------------------
drop policy if exists "NFs: ver só da própria empresa" on storage.objects;
create policy "NFs: ver (financeiro, visualizador)" on storage.objects
  for select using (
    bucket_id = 'notas-fiscais'
    and storage_empresa_id_from_path(name) = current_empresa_id()
    and has_perfil(array['admin', 'financeiro', 'visualizador'])
  );

-- 4. Comprovante de pagamento no bucket anexos -------------------------------
drop policy if exists "Anexos: ver só da própria empresa" on storage.objects;
create policy "Anexos: ver da empresa; comprovante só de quem lê pagamento" on storage.objects
  for select using (
    bucket_id = 'anexos'
    and storage_empresa_id_from_path(name) = current_empresa_id()
    and (
      coalesce((storage.foldername(name))[3], '') <> 'pagamentos'
      or has_perfil(array['admin', 'financeiro', 'visualizador', 'comercial'])
    )
  );

commit;
