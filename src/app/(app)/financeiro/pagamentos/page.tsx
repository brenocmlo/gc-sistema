import { HandCoins, Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import EmptyState from "@/components/EmptyState";
import ExportButton from "@/components/ExportButton";
import Pagination from "@/components/Pagination";
import { formatCurrency } from "@/lib/format";
import {
  isRangeForaDoAlcance,
  PERIODO_OPTIONS,
  sanitizeBusca,
  urlSemPagina,
} from "@/lib/listagem";
import { totalDosPagamentos } from "@/lib/pagamentos";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { hojeISO } from "@/lib/execucao";
import { createClient } from "@/lib/supabase/server";
import type { PagamentoListItem } from "@/lib/types";

import PagamentosFiltros from "./filters";
import { filtroDePagamentos } from "./filtro";
import PagamentosTable from "./pagamentos-table";

const PAGE_SIZE = 20;

type SearchParams = {
  busca?: string;
  obra?: string;
  origem?: string;
  forma?: string;
  periodo?: string;
  page?: string;
};

export default async function PagamentosPage({
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
  const origemFilter = searchParams.origem ?? "";
  const formaFilter = searchParams.forma ?? "";
  const periodoFilter = searchParams.periodo ?? "";

  const supabase = createClient();

  const { data: obras } = await supabase
    .from("obras")
    .select("id, codigo_obra, nome")
    .order("codigo_obra", { ascending: false });

  const obraOptions = (obras ?? []).map((o) => ({
    value: o.id,
    label: `${o.codigo_obra} — ${o.nome}`,
  }));

  // Os mesmos filtros para a página, o totalizador e o export (filtro.ts).
  const { filtrar } = await filtroDePagamentos(
    supabase,
    searchParams,
    obras ?? [],
  );

  const from = (page - 1) * PAGE_SIZE;
  const [lista, totais] = await Promise.all([
    filtrar(
      supabase
        .from("pagamentos")
        .select(
          "id, data_pagamento, obra_id, origem, forma, valor, observacao, nota_id, parcela_acordo_id, anexo, obra:obras(codigo_obra, nome), nota:notas_fiscais(numero, serie, status), parcela:acordo_parcelas(numero_parcela, acordo:acordos_pagamento(descricao))",
          { count: "exact" },
        ),
    )
      .order("data_pagamento", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1),
    filtrar(supabase.from("pagamentos").select("valor")),
  ]);

  const { data, count, error } = lista;
  if (error || totais.error) {
    if (error && isRangeForaDoAlcance(error) && page > 1) {
      redirect(
        urlSemPagina("/financeiro/pagamentos", {
          ...searchParams,
          page: undefined,
        }),
      );
    }
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700">
        Erro ao carregar pagamentos: {(error ?? totais.error)?.message}
      </div>
    );
  }

  // Cast: origem e forma vêm como `string` do gen; os CHECKs garantem as listas.
  const pagamentos = (data ?? []) as PagamentoListItem[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const somaFiltrada = totalDosPagamentos(totais.data);
  const rotuloPeriodo =
    PERIODO_OPTIONS.find((o) => o.value === periodoFilter)?.label ??
    PERIODO_OPTIONS[0].label;
  const outrosFiltros = Boolean(
    busca || obraFilter || origemFilter || formaFilter,
  );

  const extraParams = {
    busca,
    obra: obraFilter,
    origem: origemFilter,
    forma: formaFilter,
    periodo: periodoFilter,
  };
  const hasFilters = Object.values(extraParams).some((v) => v !== "");
  const isEmpty = pagamentos.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[280px]">
          <PagamentosFiltros obraOptions={obraOptions} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ExportButton
            endpoint="/api/export/pagamentos"
            searchParams={extraParams}
            filename={`pagamentos-${hojeISO()}`}
          />
          {canCreate && (
            <Link
              href="/financeiro/pagamentos/novo"
              className="inline-flex items-center gap-2 bg-gray-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-800 transition-colors whitespace-nowrap"
            >
              <Plus size={16} />
              Registrar pagamento
            </Link>
          )}
        </div>
      </div>

      {isEmpty && !hasFilters ? (
        <EmptyState
          icon={HandCoins}
          title="Nenhum pagamento registrado ainda"
          action={
            canCreate
              ? {
                  label: "Registrar pagamento",
                  href: "/financeiro/pagamentos/novo",
                }
              : null
          }
        />
      ) : (
        <>
          <div
            className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex flex-wrap items-baseline justify-between gap-2"
            aria-label="Total do período filtrado"
          >
            <span className="text-sm text-gray-600">
              {`Total recebido · ${rotuloPeriodo}${outrosFiltros ? " · com filtros" : ""}`}
            </span>
            <span className="text-lg font-semibold text-gray-900 tabular-nums">
              {formatCurrency(somaFiltrada)}
              <span className="ml-2 text-sm font-normal text-gray-500">
                {`em ${total} ${total === 1 ? "pagamento" : "pagamentos"}`}
              </span>
            </span>
          </div>

          {isEmpty ? (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-500">
              Nenhum pagamento encontrado com esses filtros.
            </div>
          ) : (
            <>
              <PagamentosTable
                pagamentos={pagamentos}
                perfil={profile?.perfil ?? null}
              />
              <Pagination
                page={page}
                totalPages={totalPages}
                total={total}
                basePath="/financeiro/pagamentos"
                entityLabel={["pagamento", "pagamentos"]}
                extraParams={extraParams}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
