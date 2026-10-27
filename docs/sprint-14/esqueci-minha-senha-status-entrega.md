# "Esqueci minha senha" — status de entrega

Correção fora de bloco, feita na janela da Sprint 14 · Data: 2026-10-19 · Branch: `main` ·
Ambiente: gc-dev (`gzbmhgnpoehormnidmgg`)

---

## Resumo

**Validado:** o link "Esqueci minha senha" agora abre um pedido que chega ao administrador, e a
rodada (`caffeinate -ims npm run validar`, 2026-10-19) passa nas sete camadas. Números na seção
Validação.

**O defeito:** o link "Esqueci minha senha" da tela de login não fazia nada. Ele levava a
`/login?reset=true`, e nenhum código lia esse parâmetro. Apareceu ao atualizar o manual de uso.

**Por que não por e-mail:** o gc-dev usa o SMTP padrão do Supabase (`smtp_host` vazio), que manda 2
e-mails por hora e só entrega para a equipe da organização. Foi o mesmo motivo do convite por link,
no 13.1. Um reset por e-mail funcionaria nos testes da equipe e falharia para os usuários reais.

**Decisão do Breno (19/10):** o pedido vai para o administrador, que manda o link de acesso que já
existe. Quando houver um SMTP próprio, o reset por e-mail pode entrar no lugar ou ao lado.

## Como ficou

1. Na tela de login, **Esqueci minha senha** troca o formulário pelo pedido. O endereço
   `/login?reset=true` também abre direto nele.
2. A pessoa digita o e-mail e clica em **Pedir novo acesso**. A tela responde: "Pedido enviado. Se o
   e-mail tiver acesso ao sistema, o administrador vai te mandar um link para criar uma senha nova."
3. O admin vê **Pedidos de novo acesso** nas pendências do Dashboard. O link leva a Configurações →
   Usuários, onde a linha da pessoa mostra **Pediu novo acesso em …**.
4. O admin gera o **link de acesso** (o ícone da chave) e manda pelo WhatsApp, como já fazia.
5. Quando a pessoa entra de novo, o pedido sai das pendências sozinho.

**Regras:**
- **Mesma resposta para todos:** com conta, sem conta, inativo ou pedido repetido, a tela responde
  igual. Assim ela não serve para descobrir quem tem acesso; só o e-mail mal digitado volta como erro.
- **Um pedido por vez:** pedidos da mesma pessoa a menos de 10 minutos um do outro não viram outro
  registro.
- **Inativo:** o usuário desativado não gera pedido.

## Arquivos

| Arquivo | O quê |
|---|---|
| `supabase/migrations/20261019100000_pedidos_acesso.sql` | Aplicada em gc-dev. Cria a tabela `pedidos_acesso`, só de leitura para o admin da empresa, sem policy de escrita; quem grava é a Server Action, com a chave de serviço. Cria também a função `pedidos_de_acesso_pendentes()`, que lê o último login em `auth.users` e devolve o pedido só se ele for mais novo |
| `src/app/login/actions.ts` | `pedirNovoAcesso`: valida, procura o perfil, aplica o intervalo e grava |
| `src/app/login/page.tsx` | O modo "Esqueci minha senha" na própria tela de login |
| `src/lib/usuarios.ts` | `esqueciSchema`, a mensagem única e `deveRegistrarPedido`, com 2 testes novos |
| `src/lib/dashboard.ts` e `_dashboard/carregar.ts` | A pendência do admin, com 1 teste estendido |
| `configuracoes/usuarios/page.tsx` e `usuarios-panel.tsx` | A marca "Pediu novo acesso" na linha |
| `src/lib/supabase/types.ts` | Regenerado (`npm run db:types`) |

## Validação

Rodada final (`caffeinate -ims npm run validar`, 2026-10-19):

| Camada | Resultado | Desta correção |
|---|---|---|
| sobras | nenhuma em gc-dev | — |
| estático | **limpo** (`tsc` + `next lint`) | — |
| unitário | **409 casos** | **2 casos novos** (e-mail do pedido e intervalo de 10 minutos) e 1 estendido (a pendência do admin) |
| build | **65 rotas**, iguais à baseline | nenhuma rota nova: o pedido vive na própria `/login` |
| runtime | **319/319 rotas** e as **342 células** da varredura de URL direta | — |
| dados | **63/63 checagens** | **1 checagem**: a consulta dos pedidos roda como admin, e o comercial recebe lista vazia |
| escrita | **520/520 passos** | **7 passos**: e-mail inválido recusado; e-mail sem conta e com conta recebem a mesma resposta, e só o com conta grava; o admin vê o pedido; repetir não duplica; o comercial não vê nada, nem pela tabela; depois de um login de verdade o pedido sai das pendências; limpeza |
| navegador | **266/266 passos** | **passo 53**, 4 checagens: o link abre o pedido e o zod barra o e-mail vazio; o pedido é aceito com a mensagem; o Dashboard do admin mostra "Pedidos de novo acesso"; a linha em Usuários mostra "Pediu novo acesso". Screenshots `53-esqueci-senha.png` e `53-pedido-em-usuarios.png` |

**Rodadas:**
1. Parou no navegador, logo no primeiro login. O login funcionava, mas a primeira compilação do
   Dashboard no `next dev` passou dos 20 s que o passo esperava. A espera passou para 60 s, como nas
   outras primeiras compilações do roteiro.
2. Parou no passo novo, por um erro meu no roteiro (faltava importar o cliente do Supabase).
3. **Final:** passou nas sete camadas.

## Registro para quem for operar gc-prod

A migration `20261019100000_pedidos_acesso.sql` entra depois das da Sprint 13. Ela só cria coisa
nova (tabela, policy, função) e não mexe em dado. A Server Action precisa de
`SUPABASE_SERVICE_ROLE_KEY` no servidor, a mesma da gestão de usuários.
