-- ============================================================
-- 13.3 Comprovante de pagamento: só quem registra pagamento envia
-- ============================================================
-- Achado pela matriz de RLS (scripts/validacao/matriz-rls.mjs) em 2026-10-07:
-- o insert do bucket anexos aceita admin, comercial, produção, medição e
-- financeiro em qualquer pasta. Produção, medição e comercial conseguiam pôr
-- um "comprovante" em <empresa>/<x>/pagamentos/, a pasta que a aba de
-- pagamentos lê. A pasta passa a seguir a mesma regra da tabela pagamentos
-- (admin e financeiro); o resto do bucket não muda.
-- ============================================================

begin;

drop policy if exists "Anexos: upload na própria empresa" on storage.objects;
create policy "Anexos: upload na própria empresa; comprovante só financeiro" on storage.objects
  for insert with check (
    bucket_id = 'anexos'
    and storage_empresa_id_from_path(name) = current_empresa_id()
    and (
      (
        coalesce((storage.foldername(name))[3], '') <> 'pagamentos'
        and has_perfil(array['admin', 'comercial', 'producao', 'medicao', 'financeiro'])
      )
      or (
        (storage.foldername(name))[3] = 'pagamentos'
        and has_perfil(array['admin', 'financeiro'])
      )
    )
  );

commit;
