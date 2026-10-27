# supabase/ — migrations e scripts

## Layout

```
supabase/
  config.toml                     config mínima da CLI (link, migration, db push)
  migrations/                     histórico versionado — o que a CLI aplica
    20260424121550_initial.sql  (era 001)
    20260424121551_rls_policies.sql  (era 002)
    20260424121552_storage_buckets.sql  (era 003)
    20260511151924_revisao_schema.sql  (era 004) ⚠️ destrutiva
    20260512135125_rls_clientes.sql  (era 005)
    20260512141810_fix_calcular_valores_obra.sql  (era 006)
    20260512151918_progresso_itens_obra.sql  (era 007)
    20260901120909_documentos_processamento.sql  (era 008)
    20260901120910_contatos_whatsapp.sql  (era 009)
    20260901120911_storage_bucket_documentos_processamento.sql  (era 010)
    20260905180000_propostas_historico.sql
    20260905190000_fix_calcular_valores_obra_ambiguidade.sql
    20260908120000_orcamentos_historico.sql
    20260921150000_contatos_canal.sql
    20260922120000_recalculo_valor_por_itens.sql
    20260922130000_recalculo_valor_trava_pai.sql
    20260922140000_recalculo_valor_security_definer.sql
    20260923120000_itens_reordenar_ajustar.sql
    20260923130000_auditoria_eventos.sql
    20260923131000_auditoria_referencia.sql
    20260923160000_contratos_desconto_historico.sql
    20260923161000_itens_de_contrato.sql
    20260923162000_gerar_contrato_de_proposta.sql
    20260924100000_contatos_nome.sql
    20260924110000_execucao_varias_por_item.sql
    20260924120000_execucao_nomes_checks.sql
    20260924130000_execucao_data_fim_total.sql
    20260925100000_documentos_revisao.sql
    20260925120000_execucao_medicoes.sql
    20260925130000_documentos_conferencia.sql
    20260928100000_recalculo_valor_sem_deadlock.sql
    20260928110000_automacao_eventos.sql
    20260928120000_automacao_eventos_ordem.sql
    20260929100000_nf_cancelada_terminal.sql
    20260930200000_pagamento_parcela_cancelada_e_comprovante.sql
    20260930210000_criar_acordo_com_parcelas.sql
    20260930220000_converter_acordo_em_nf.sql
    20261005120000_usuarios_protecao_perfil.sql
    20261006100000_auditoria_historico_nf.sql
    20261007100000_rls_revisao_13_3.sql
    20261007110000_rls_comprovante_upload.sql
    20261007120000_recalculo_valor_definer_de_volta.sql
    20261008100000_documentos_opcoes_obra.sql
    20261012100000_propostas_aditivo_de_contrato.sql
    20261012110000_propostas_aditivo_fk.sql
    20261019100000_pedidos_acesso.sql
  000_reset_dev.sql               script de dev — NÃO é migration
  setup_inicial_dev.sql           script de dev — NÃO é migration
  seed_orcamentos.sql             seed manual — NÃO é migration
  verificar_schema_aplicado.sql   diagnóstico somente leitura
```

São **46 migrations** (contagem de 2026-10-26). As dez primeiras levam
como timestamp as datas reais dos commits que as introduziram, então a ordem
cronológica é a mesma da numeração antiga. A numeração `00X_` ficou registrada
acima porque a documentação e as tarefas do ClickUp falam nesses números.

A ordem completa com o que cada uma faz de arriscado (destrutiva, mexe em dado,
constraint nova, troca de policy, sem `begin/commit`) está em
`docs/tecnicos/runbook-producao.md`, seção 4.

## Adoção — rodar UMA vez por ambiente

> **Em gc-dev isto JÁ FOI FEITO e não precisa repetir.** O `repair` das dez
> versões rodou em 2026-09-05, no bloco 4.1. Em 2026-09-21 o `migration list`
> mostrava 13 alinhadas nos dois lados. Desde então, segundo os documentos de
> entrega, cada migration nova entrou em gc-dev por `db push` no próprio bloco, e
> o repositório tem 46 (2026-10-26). O `migration list` não foi rodado de novo
> nesta revisão. `db push` em gc-dev não exige preparo nenhum.
>
> **O que está abaixo vale para gc-prod**, quando despausar, e como registro de
> como o ambiente foi adotado. Se você veio parar aqui vindo do `CLAUDE.md`
> achando que há uma pendência bloqueando gc-dev: não há.

**O passo do `repair` não é opcional** — ao adotar um ambiente novo. As
migrations já estão todas aplicadas em gc-dev (verificado em 2026-09-02, 21/21
checagens), mas naquele momento a CLI não sabia disso: o histórico remoto
estava vazio. Um `db push` antes do `repair` tentaria reaplicar tudo, começando
pela `revisao_schema` (ex-004) — que é destrutiva e não idempotente. Ela está
envolvida em `begin/commit`, então abortaria sem estragar nada, mas o susto é
desnecessário.

```bash
# 1. autenticar (o fluxo de navegador precisa de TTY; sem TTY, use --token)
npx supabase login

# 2. linkar no projeto de dev
npx supabase link --project-ref gzbmhgnpoehormnidmgg

# 3. marcar como JÁ APLICADAS as dez migrations existentes
npx supabase migration repair --status applied \
  20260424121550 20260424121551 20260424121552 \
  20260511151924 20260512135125 20260512141810 20260512151918 \
  20260901120909 20260901120910 20260901120911

# 4. conferir: as dez devem aparecer como aplicadas nos dois lados
npx supabase migration list
```

Quando **gc-prod** despausar, o mesmo processo — mas lá o `repair` só vale pras
migrations que o `verificar_schema_aplicado.sql` mostrar como aplicadas. O que
faltar entra por `db push`, na ordem, com backup e janela de manutenção (a
`revisao_schema` dropa 13 colunas de `obras` e 6 de `orcamentos`).

O verificador cobre só da 004 à 010. As outras 36 foram criadas a partir de
2026-09-05, com o gc-prod já pausado, e a hipótese é que nenhuma está lá.
Confirmar no catálogo antes do push. O passo a passo completo, registro para
quem for operar prod, está em `docs/tecnicos/runbook-producao.md` (seções 2 a 4).

## Dia a dia, depois da adoção

```bash
npx supabase migration new nome_do_que_muda   # cria o arquivo com timestamp
# escreve o SQL, sempre dentro de begin; ... commit;
npx supabase db push                          # aplica o que falta no ambiente linkado
npm run db:types                              # regenera src/lib/supabase/types.ts
```

Duas regras que o histórico deste repo justifica:

1. **Toda migration dentro de `begin; … commit;`.** A ex-008 e a ex-009 não
   estavam, e uma falha no meio deixaria tabela criada sem policies — estado
   parcial que nenhum script daqui sabe retomar.
2. **Nada de `create or replace view` que redefina uma view mexida depois.** A
   ex-004 recria `obras_com_valores` no fim; se rodar depois da ex-007, a
   coluna `progresso_itens_pct` desaparece e `/obras` quebra em runtime. Com o
   histórico da CLI a ordem passa a ser garantida, mas a regra continua válida
   pra views recriadas em migrations novas.
