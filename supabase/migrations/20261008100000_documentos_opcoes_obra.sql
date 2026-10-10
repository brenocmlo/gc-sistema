-- Decisão 31 (Breno, 07/10): obra não identificada vira pergunta pelo bot.
-- As opções oferecidas ficam no documento para a resposta ("2") ser conferida
-- contra o que foi perguntado, não contra o cadastro de agora. Nulo = nenhuma
-- pergunta em aberto.
alter table public.documentos_processamento
  add column if not exists opcoes_obra jsonb;

comment on column public.documentos_processamento.opcoes_obra is
  'Pergunta da obra em aberto no bot: [{id, rotulo}] na ordem numerada enviada. Nulo quando não há pergunta.';

-- A rota de resposta procura a pergunta aberta do chat.
create index if not exists documentos_processamento_pergunta_obra_idx
  on public.documentos_processamento (canal_chat_id, created_at desc)
  where opcoes_obra is not null;
