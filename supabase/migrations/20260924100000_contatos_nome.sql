-- Fase 7 da automação: nome do contato autorizado a mandar documentos pelo bot.
--
-- Por que: a tela /configuracoes/contatos listava só o código do Telegram
-- (ex.: 884349214) ou o telefone, sem dizer de quem é. O admin cadastra a
-- partir do código que o bot manda à pessoa (decisão 4), e precisa saber depois
-- quem é quem. Opcional: contatos antigos seguem válidos sem nome.
--
-- Não mexe em nada que o n8n lê (empresa_id, obra_id, canal, telegram_chat_id).

alter table contatos_whatsapp
  add column if not exists nome text;

comment on column contatos_whatsapp.nome is
  'Nome de quem manda documentos por este contato (ex.: Lúcio - comprador). Opcional.';
