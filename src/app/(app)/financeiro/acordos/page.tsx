import { Handshake, Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import EmptyState from "@/components/EmptyState";
import Pagination from "@/components/Pagination";
import { hojeISO } from "@/lib/execucao";
import ExportButton from "@/components/ExportButton";
import {
  isRangeForaDoAlcance,
  sanitizeBusca,
  urlSemPagina,
} from "@/lib/listagem";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import type { AcordoListItem } from "@/lib/types";

import AcordosTable from "./acordos-table";
import AcordosFiltros from "./filters";
import { filtroDeAcordos } from "./filtro";

const PAGE_SIZE = 20;

type SearchParams = {
  busca?: string;
  obra?: string;
  status?: string;
  motivo?: string;
  periodo?: string;
  page?: string;
};

export default async function AcordosPage({
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
  const statusFilter = searchParams.status ?? "";
  const motivoFilter = searchParams.motivo ?? "";
  const periodoFilter = searchParams.periodo ?? "";
  // Um "hoje" só para a requisição: o selo de atrasada.
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

  // Os mesmos filtros da página e do export (filtro.ts).
  const { filtrar } = filtroDeAcordos(searchParams, obras ?? []);
  const query = filtrar(
    supabase
      .from("acordos_pagamento")
      .select(
        "id, descricao, obra_id, motivo, periodo_ref, data_abertura, data_encerramento, status, obra:obras(codigo_obra, nome), parcelas:acordo_parcelas(valor_previsto, status, data_vencimento)",
        { count: "exact" },
      ),
  )
    .order("data_abertura", { ascending: false })
    .order("created_at", { ascending: false });

  const from = (page - 1) * PAGE_SIZE;
  const { data, count, error } = await query.range(from, from + PAGE_SIZE - 1);

  if (error) {
    if (isRangeForaDoAlcance(error) && page > 1) {
      redirect(
        urlSemPagina("/financeiro/acordos", {
          ...searchParams,
          page: undefined,
        }),
      );
    }
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700">
        Erro ao carregar acordos: {error.message}
      </div>
    );
  }

  // Cast: status e motivo vêm como `string` do gen; os CHECKs garantem as listas.
  const acordos = (data ?? []) as AcordoListItem[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const extraParams = {
    busca,
    obra: obraFilter,
    status: statusFilter,
    motivo: motivoFilter,
    periodo: periodoFilter,
  };
  const hasFilters = Object.values(extraParams).some((v) => v !== "");
  const isEmpty = acordos.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[280px]">
          <AcordosFiltros obraOptions={obraOptions} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ExportButton
            endpoint="/api/export/acordos"
            searchParams={extraParams}
            filename={`acordos-${hoje}`}
          />
          {canCreate && (
            <Link
              href="/financeiro/acordos/novo"
              className="inline-flex items-center gap-2 bg-gray-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-800 transition-colors whitespace-nowrap"
            >
              <Plus size={16} />
              Novo acordo
            </Link>
          )}
        </div>
      </div>

      {isEmpty && !hasFilters ? (
        <EmptyState
          icon={Handshake}
          title="Nenhum acordo de pagamento ainda"
          action={
            canCreate
              ? { label: "Novo acordo", href: "/financeiro/acordos/novo" }
              : null
          }
        />
      ) : isEmpty ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-500">
          Nenhum acordo encontrado com esses filtros.
        </div>
      ) : (
        <>
          <AcordosTable acordos={acordos} hoje={hoje} />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            basePath="/financeiro/acordos"
            entityLabel={["acordo", "acordos"]}
            extraParams={extraParams}
          />
        </>
      )}
    </div>
  );
}
