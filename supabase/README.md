# supabase/ — migrations e scripts

## Layout

```
supabase/
  config.toml                     config mínima da CLI (link, migration, db push)
  migrations/                     histórico versionado — o que a CLI aplica
    20260424121550_initial.sql              (era 001)
    20260424121551_rls_policies.sql         (era 002)
    20260424121552_storage_buckets.sql      (era 003)
    20260511151924_revisao_schema.sql       (era 004) ⚠️ destrutiva
    20260512135125_rls_clientes.sql         (era 005)
    20260512141810_fix_calcular_valores_obra.sql (era 006)
    20260512151918_progresso_itens_obra.sql (era 007)
    20260901120909_documentos_processamento.sql (era 008)
    20260901120910_contatos_whatsapp.sql    (era 009)
    20260901120911_storage_bucket_documentos_processamento.sql (era 010)
  000_reset_dev.sql               script de dev — NÃO é migration
  setup_inicial_dev.sql           script de dev — NÃO é migration
  seed_orcamentos.sql             seed manual — NÃO é migration
  verificar_schema_aplicado.sql   diagnóstico somente leitura
```

Os timestamps são as datas reais dos commits que introduziram cada arquivo,
então a ordem cronológica é a mesma da numeração antiga. A numeração `00X_`
ficou registrada acima porque a documentação e as tarefas do ClickUp falam
nesses números.

## Adoção — rodar UMA vez por ambiente

> **Estado em 2026-09-21: em gc-dev isto JÁ FOI FEITO e não precisa repetir.**
> O `repair` das dez versões rodou em 2026-09-05, no bloco 4.1, e o
> `migration list` mostra as 13 alinhadas nos dois lados. `db push` em gc-dev
> não exige preparo nenhum.
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
