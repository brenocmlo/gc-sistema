# scripts/automacao

## `n8n-processar-documento-grupo.json`

O workflow **Obraminds - Processar Documento** (`thlKSZcBPX84Y51N`) já com o envio de documentos
pelo grupo do Telegram: 40 nós. É o workflow ativo de hoje (38 nós) sem `Supabase - Buscar contato`,
com `Rota - Triagem do Telegram`, `Responder em citação?` e `Telegram - Responder`, e com os campos
`remetente_id`, `mensagem_id` e `reply_to` passando pelos nós de aviso. Spec: seção 8 de
`docs/automacao/envio-pelo-grupo-status-entrega.md` e decisões 33 a 38 de
`docs/automacao/migracao-telegram-integracao-automacao.md`.

**Não está publicado.** Publicar antes do deploy derruba o bot (a rota nova responderia 404, inclusive
na conversa privada). Credenciais e IDs de nó são os do workflow ativo.

## Ordem de publicação

1. **Deploy** do gc-sistema na Vercel (com a migration `20261027100000` já aplicada) e a variável
   **`TELEGRAM_BOT_USERNAME`** (sem `@`) na Vercel; conferir `TELEGRAM_BOT_TOKEN`. Conferir que um
   `POST` sem token em `/api/ingestao/triagem-telegram` devolve 401.
2. **Importar/atualizar o workflow** no n8n com o conteúdo do arquivo (no n8n, "Import from file"
   sobre `thlKSZcBPX84Y51N`, ou colar o JSON), abrir e conferir as credenciais (`Telegram — ObraMinds
   Ingestão (produção)`, `gc-sistema — rota de ingestão`, `Supabase — gc-dev (service)`), rodar a
   validação do n8n (0 erros) e publicar. O `Telegram - Responder` é um nó novo: se o n8n pedir,
   reassociar a credencial do Telegram.
3. **Teste da Fase 0 no grupo**, com o privacy ligado: PDF com `/enviar@<bot>`, PDF com menção ao
   bot, PDF em resposta a mensagem do bot, PDF solto (deve ser ignorado). Depois, uma conversa
   privada de pessoa liberada.

## Como voltar

- **Pelo n8n:** em Histórico de versões do workflow, restaurar a versão
  **`3598b2b4-a6fd-47d0-bdf7-eabb909cb686`** (a ativa antes desta mudança) e publicar.
- **Pelo backup:** o JSON completo do workflow antes da mudança foi guardado em
  `/Users/a1234/.claude/jobs/c6e80632/tmp/n8n-backup-thlKSZcBPX84Y51N.json` (fora do repositório;
  copiar para um lugar seguro). O conteúdo útil está em `.data` (`nodes`, `connections`, `settings`).
- O deploy do código é compatível com o n8n antigo (sem `remetenteId`, a `resposta-obra` funciona
  como hoje), então voltar o workflow não exige voltar o deploy.
