# Prompt para a sessão nova — Fase 0

Abra o Claude Code em `/Users/a1234/gc-sistema` e cole o bloco abaixo.

---

```
Você vai executar a Fase 0 da migração de WhatsApp (Z-API) para Telegram.

LEIA PRIMEIRO, nesta ordem:
1. CLAUDE.md deste repositório — as regras valem integralmente, em especial
   `npm run validar` antes de declarar qualquer coisa pronta, só gc-dev, e
   não commitar sem pedido explícito.
2. docs/automacao/migracao-telegram-integracao-automacao.md — o plano. A
   Seção 4 tem 13 decisões FECHADAS: não reabra nenhuma. Se alguma parecer
   errada, pare e avise.
3. docs/automacao/fase-0-runbook.md — o que é seu e o que é do Breno.
4. docs/automacao/fase-1-contatos-canal-status-entrega.md — o que já está
   aplicado em gc-dev.

ANTES DE QUALQUER COISA: confirme que você tem ferramentas `n8n_*`
disponíveis. O servidor n8n-mcp foi acrescentado ao escopo deste projeto em
21/09/2026 e só carrega em sessão nova. Se NÃO houver ferramenta n8n, pare e
avise — não tente contornar editando JSON de workflow na mão.

SEU ESCOPO é a Parte B do runbook, e só ela:
- cadastrar os dois tokens do Telegram como Credential "Telegram API" no n8n
  (o Breno te passa os tokens; nenhum token em nó HTTP, em documento ou em
  log);
- um workflow DESCARTÁVEL com Telegram Trigger, só para provar que a mensagem
  chega e o chat_id aparece no log;
- confirmar o comportamento do Telegram Trigger em n8n Cloud (URL de teste vs.
  produção, re-registro de webhook ao ativar/desativar);
- fechar a decisão 6: abrir o workflow dOt8aiCX2OCr08RH (Integração Oficial —
  Contrato) e descobrir QUAL status ele escreve em documentos_processamento ao
  registrar um contrato. O CHECK dessa tabela aceita só PENDENTE,
  ERRO_VALIDACAO, REVISAO_HUMANA e APROVADO — confirmado no banco em
  21/09/2026. Se o 4a usar APROVADO, a proposta usa APROVADO também e o CHECK
  NÃO muda. Se usar outro valor fora do CHECK, PARE E AVISE.

FORA DO SEU ESCOPO, não faça: criar o sub-workflow Notificar (Fase 2), editar
qualquer um dos 7 workflows existentes (Fase 3), criar a ingestão por Telegram
(Fase 4). Se você se pegar editando workflow de produção, saiu do escopo.

CUIDADO CONHECIDO: `n8n_health_check` MENTE — devolve connected:true com API
key inválida. Só reiniciar o Claude Code recarrega a env.

ATENÇÃO: outra sessão está trabalhando em paralelo na sprint 5 (Itens), no
mesmo repositório e na mesma branch (feature-dev-breno-automacao). Ela está
mexendo em src/lib/itens.ts, src/lib/types.ts e nos scripts de validação. NÃO
toque nesses arquivos. Seu trabalho é no n8n; se precisar mexer em arquivo do
repositório, avise antes.

AO TERMINAR: escreva docs/automacao/fase-0-status-entrega.md, seguindo o
formato de docs/automacao/fase-1-contatos-canal-status-entrega.md — números
reais, e o que não foi validado listado nominalmente. Documento de automação
NUNCA leva número de bloco m.n: essa trilha é a lista "OCR Contratos
(WhatsApp) — Breno" no ClickUp, que tem numeração própria. Ver docs/README.md.
```
