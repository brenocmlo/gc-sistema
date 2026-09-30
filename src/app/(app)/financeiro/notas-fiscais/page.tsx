import { Plus, Receipt } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import EmptyState from "@/components/EmptyState";
import ExportButton from "@/components/ExportButton";
import Pagination from "@/components/Pagination";
import { hojeISO } from "@/lib/execucao";
import {
  computePeriodoCutoff,
  isRangeForaDoAlcance,
  sanitizeBusca,
  urlSemPagina,
} from "@/lib/listagem";
import { filtroDaSituacao, isNfTipo, isSituacaoNf } from "@/lib/notas-fiscais";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import type { NotaFiscalListItem } from "@/lib/types";

import NotasFiltros from "./filters";
import NotasTable from "./notas-table";

const PAGE_SIZE = 20;

type SearchParams = {
  busca?: string;
  obra?: string;
  tipo?: string;
  status?: string;
  periodo?: string;
  page?: string;
};

export default async function NotasFiscaisPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const profile = await getCurrentProfile();
  const canCreate =
    profile?.perfil === "admin" || profile?.perfil === "financeiro";

  const page = Math.max(1, Number.parseInt(searchParams.page ?? "1", 10) || 1);
  const busca = sanitizeBusca(searchParams.busca ?? "");
  const obraFilter = searchParams.obra ?? "";
  const tipoFilter = searchParams.tipo ?? "";
  const statusFilter = searchParams.status ?? "";
  const periodoFilter = searchParams.periodo ?? "";
  // Um "hoje" só para a requisição: o filtro e o selo de vencida.
  const hoje = hojeISO();

  const supabase = createClient();

  const { data: obras } = await supabase
    .from("obras")
    .select("id, codigo_obra, nome")
    .order("codigo_obra", { ascending: false });

  const obraOptions = (obras ?? []).map((o) => ({
    value: o.id,
    label: `${o.codigo_obra} — ${o.nome}`,
  }));

  let query = supabase
    .from("notas_fiscais")
    .select(
      "id, numero, serie, chave_nfe, obra_id, tipo, data_emissao, data_vencimento, valor_total, status, obra:obras(codigo_obra, nome), pagamentos(valor)",
      { count: "exact" },
    )
    .order("data_emissao", { ascending: false })
    .order("numero", { ascending: false });

  if (busca) {
    // Obra por código ou nome, resolvida na lista já carregada.
    const termo = busca.toLowerCase();
    const obraIds = (obras ?? [])
      .filter(
        (o) =>
          o.codigo_obra.toLowerCase().includes(termo) ||
          o.nome.toLowerCase().includes(termo),
      )
      .map((o) => o.id);
    const filtros = [
      `numero.ilike.%${busca}%`,
      `chave_nfe.ilike.%${busca}%`,
      obraIds.length > 0 ? `obra_id.in.(${obraIds.join(",")})` : null,
    ].filter(Boolean);
    query = query.or(filtros.join(","));
  }

  if (obraFilter) query = query.eq("obra_id", obraFilter);
  if (tipoFilter && isNfTipo(tipoFilter)) query = query.eq("tipo", tipoFilter);

  if (statusFilter && isSituacaoNf(statusFilter)) {
    const f = filtroDaSituacao(statusFilter, hoje);
    query = query.in("status", f.status);
    if (f.vencimentoAntesDe)
      query = query.lt("data_vencimento", f.vencimentoAntesDe);
    if (f.naoVencidaEm)
      query = query.or(
        `data_vencimento.is.null,data_vencimento.gte.${f.naoVencidaEm}`,
      );
  }

  // Período sobre a data de emissão.
  const cutoff = computePeriodoCutoff(periodoFilter);
  if (cutoff) query = query.gte("data_emissao", cutoff);

  const from = (page - 1) * PAGE_SIZE;
  const { data, count, error } = await query.range(from, from + PAGE_SIZE - 1);

  if (error) {
    if (isRangeForaDoAlcance(error) && page > 1) {
      redirect(
        urlSemPagina("/financeiro/notas-fiscais", {
          ...searchParams,
          page: undefined,
        }),
      );
    }
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700">
        Erro ao carregar notas fiscais: {error.message}
      </div>
    );
  }

  // Cast: status e tipo vêm como `string` do gen; os CHECKs garantem as listas.
  const notas = (data ?? []) as NotaFiscalListItem[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const extraParams = {
    busca,
    obra: obraFilter,
    tipo: tipoFilter,
    status: statusFilter,
    periodo: periodoFilter,
  };
  const hasFilters = Object.values(extraParams).some((v) => v !== "");
  const isEmpty = notas.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[280px]">
          <NotasFiltros obraOptions={obraOptions} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ExportButton
            endpoint="/api/export/notas-fiscais"
            searchParams={extraParams}
            filename={`notas-fiscais-${hoje}`}
          />
          {canCreate && (
            <Link
              href="/financeiro/notas-fiscais/novo"
              className="inline-flex items-center gap-2 bg-gray-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-800 transition-colors whitespace-nowrap"
            >
              <Plus size={16} />
              Nova nota fiscal
            </Link>
          )}
        </div>
      </div>

      {isEmpty && !hasFilters ? (
        <EmptyState
          icon={Receipt}
          title="Nenhuma nota fiscal cadastrada ainda"
          action={
            canCreate
              ? {
                  label: "Nova nota fiscal",
                  href: "/financeiro/notas-fiscais/novo",
                }
              : null
          }
        />
      ) : isEmpty ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-500">
          Nenhuma nota fiscal encontrada com esses filtros.
        </div>
      ) : (
        <>
          <NotasTable notas={notas} hoje={hoje} />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            basePath="/financeiro/notas-fiscais"
            entityLabel={["nota fiscal", "notas fiscais"]}
            extraParams={extraParams}
          />
        </>
      )}
    </div>
  );
}
