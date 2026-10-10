-- ============================================================
-- 13.2 Aba Histórico da nota fiscal: quem vê a NF vê os eventos dela
-- ============================================================
-- `auditoria_eventos` só é lida pelo admin (019), porque a tela /logs junta
-- tudo da empresa. A aba Histórico da NF lê da mesma tabela, filtrada pela
-- NF, e precisa abrir para quem trabalha com a NF: os mesmos perfis do
-- layout de /financeiro (admin, financeiro e visualizador).
--
-- A policy nova soma à do admin (policies de select se combinam com OR) e
-- abre só eventos de `notas_fiscais` cuja NF a pessoa ainda enxerga: o
-- `exists` passa pela RLS de notas_fiscais. Evento de NF excluída deixa de
-- aparecer na aba e continua no /logs do admin.
-- ============================================================

begin;

drop policy if exists "Auditoria: histórico da NF (financeiro)" on auditoria_eventos;

create policy "Auditoria: histórico da NF (financeiro)" on auditoria_eventos
  for select using (
    entidade = 'notas_fiscais'
    and empresa_id = current_empresa_id()
    and has_perfil(array['admin', 'financeiro', 'visualizador'])
    and exists (
      select 1 from notas_fiscais n where n.id = auditoria_eventos.registro_id
    )
  );

commit;
