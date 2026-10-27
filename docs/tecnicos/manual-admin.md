# Manual do administrador · gc-sistema

Bloco 15.1 "Manual do usuário por perfil" · Guia do perfil **Admin** · Escrito a partir do código
em 2026-10-26

---

## Para quem é

Para quem tem o perfil **Admin**. Na escolha de perfil do convite, a descrição dele é: *"Tudo,
inclusive usuários, configurações, estornos e exclusões"*.

O admin vê todas as telas dos outros perfis e faz o que eles fazem. Este guia cobre só o que é
dele: usuários, configurações, logs, e as exclusões e estornos. O dia a dia de cada área está nos
outros manuais:

| Área | Manual |
|---|---|
| Clientes, orçamentos, propostas, contratos, documentos | `manual-comercial.md` |
| Execução e medição | `manual-producao-medicao.md` |
| Notas fiscais, pagamentos, acordos, FD | `manual-financeiro.md` |

## O que cada perfil pode fazer

Derivada do menu (`src/lib/nav.ts`), dos guards de layout e das checagens das Server Actions.
**V** = vê; **E** = cria e edita; **—** = não abre (o endereço direto volta para o Dashboard).

| Tela ou ação | Admin | Comercial | Produção | Medição | Financeiro | Visualizador |
|---|---|---|---|---|---|---|
| Dashboard | V | V | V | V | V | V |
| Clientes, Orçamentos, Propostas, Contratos | E | E | — | — | — | V |
| Documentos (bot do Telegram) | E | E | — | — | — | V |
| Obras | E | E | V | V | V | V |
| Execução: ver | V | — | V | V | — | V |
| Execução: apontar | E | — | E | E | — | — |
| Relatório de medição (PDF) | sim | — | — | sim | sim | — |
| Financeiro e Faturamento Direto | E | — | — | — | E | V |
| Relatório FD (PDF) | sim | — | — | — | sim | sim |
| Logs e auditoria | V | — | — | — | — | — |
| Configurações: Empresa, Contatos do bot, Usuários | E | — | — | — | — | — |
| Meu perfil | E | E | E | E | E | E |

**Só o admin**, em qualquer tela:

| Ação | Onde | Recado para quem não é admin |
|---|---|---|
| Excluir cliente | Editar cliente → **Excluir** | "Apenas admin pode excluir clientes" |
| Excluir obra | Editar obra → **Excluir** | "Apenas admin pode excluir obras" |
| Excluir orçamento | Detalhe do orçamento → **Excluir** | "Apenas admin pode excluir orçamentos" |
| Excluir proposta | Detalhe da proposta → **Excluir** | — |
| Excluir item de proposta ou contrato | Aba Itens → **Excluir** | — |
| Excluir nota fiscal | Detalhe da NF → **Excluir** | "Só o admin exclui nota fiscal" |
| Estornar pagamento | Pagamentos e detalhe da NF → **Estornar** | "Só o admin estorna pagamentos" |
| Excluir FD | Detalhe do FD → **Excluir** | "Apenas admin pode excluir FDs" |
| Recusar o que o bot lançou | Faixa de conferência → **Não aceitar** | "Só o administrador pode desfazer o que o bot criou" |
| Excluir anexo de outra pessoa | Aba Anexos → **Excluir** | "Só o admin ou quem enviou o arquivo pode excluí-lo" |

Contrato não tem exclusão: ele é rescindido (ver `manual-comercial.md`).

## O menu do admin

O admin vê todos os itens: Dashboard, Clientes, Orçamentos, Obras, Propostas, Contratos,
Documentos, Execução, Financeiro, Faturamento Direto, **Logs e auditoria** e, no rodapé,
**Configurações**. Meu perfil é a quarta aba de Configurações, ou o seu nome no cabeçalho →
**Meu perfil**.

**Dashboard:** o admin vê as três seções (comercial, operação e financeiro). Nas pendências, além
das dos outros perfis, aparece **Pedidos de novo acesso**, que leva a Configurações → Usuários. Os
atalhos são **Novo orçamento**, **Nova proposta**, **Execução**, **Registrar pagamento** e **Logs
e auditoria**.

[tela: 49-dashboard.png] · [tela: 49-dashboard-390.png]

## Usuários

**Configurações → Usuários.** A lista mostra **Nome** (com e-mail e telefone), **Perfil**,
**Situação** e **Último acesso**. No topo, o total ("N usuários · N com acesso").

| Situação | Quer dizer |
|---|---|
| **Ativo** | Já entrou no sistema |
| **Convite pendente** | Convidado, ainda não criou a senha |
| **Inativo** | Desativado pelo admin; não entra |

O sistema **não manda e-mail**. Todo acesso, convite ou senha nova, é um **link** que o admin
copia e manda à pessoa, pelo WhatsApp ou como preferir.

### Convidar

1. Clique em **Convidar usuário**.
2. Preencha **Nome**, **E-mail** (é o login), **Perfil** e, se quiser, **Telefone**. Ao escolher o
   perfil, a descrição dele aparece embaixo.
3. Clique em **Convidar e gerar link**.
4. A janela **Link de convite** mostra o link. Clique em **Copiar link** ou **Enviar pelo
   WhatsApp**. Com telefone, o WhatsApp já abre na conversa da pessoa, com a mensagem pronta.
5. A pessoa abre o link, cria a senha (**Senha** e **Confirme a senha**, mínimo de 8 caracteres) e
   clica em **Criar senha e entrar**.

O link **vale 1 hora e só funciona uma vez**. Se vencer, gere outro (abaixo).

[tela: 52-convite-link.png] · [tela: 52-convite-senha.png]

**Erros do convite:**

| Mensagem | O que fazer |
|---|---|
| "Já existe um usuário com esse e-mail na empresa" | Procure a pessoa na lista |
| "Esse e-mail já tem acesso ao sistema" | O e-mail já tem conta. Use outro, ou fale com o suporte |
| "Sem acesso à administração do Auth (…)" | O servidor está sem a chave de serviço. A lista aparece, mas convite e links não funcionam. Fale com o suporte |

### Gerar link de acesso (senha esquecida ou convite vencido)

Na linha da pessoa, clique na **chave** ("Gerar link de acesso"). A janela **Link de acesso**
mostra o link; mande como no convite. A pessoa define uma senha nova e entra (**Salvar senha e
entrar**). Para quem ainda tem convite pendente, a janela se chama **Link de convite**.

A chave não aparece para usuário inativo. Reative antes.

### Pedidos "Esqueci minha senha"

1. A pessoa clica em **Esqueci minha senha** no login, digita o e-mail e clica em **Pedir novo
   acesso**. O pedido vem para o admin.
2. O admin vê **Pedidos de novo acesso** nas pendências do Dashboard.
3. Em Usuários, a linha da pessoa mostra **Pediu novo acesso em …**.
4. Gere o link pela chave e mande à pessoa.
5. Quando ela entra de novo, o pedido sai das pendências sozinho.

A tela de login responde igual para qualquer e-mail, com ou sem conta. Usuário inativo não gera
pedido. Dois pedidos da mesma pessoa a menos de 10 minutos viram um só.

[tela: 53-esqueci-senha.png] · [tela: 53-pedido-em-usuarios.png]

### Editar

Clique no **lápis** da linha. Mudam **Nome**, **Perfil** e **Telefone**. O **e-mail não muda**:
é o login. Clique em **Salvar**.

### Desativar e reativar

1. Clique no **botão de liga e desliga** da linha (**Desativar** ou **Reativar**).
2. Confirme no diálogo.

**Desativar:** a pessoa deixa de entrar na hora. O login é recusado com "Seu acesso está
desativado. Fale com o administrador.", e a sessão aberta para de valer. O histórico do que ela
fez continua.

**Reativar:** a pessoa volta a entrar com a senha que já tinha.

**Travas:**
- O botão não aparece na sua própria linha: o admin não desativa o próprio acesso.
- A empresa precisa de **ao menos um admin ativo**. Rebaixar ou desativar o último é recusado.
- Não há exclusão de usuário. Quem sai da empresa é desativado.

## Configurações

As abas são **Empresa**, **Contatos do bot**, **Usuários** e **Meu perfil**. Os outros perfis veem
só Meu perfil.

### Empresa

Os dados que aparecem nos relatórios PDF e em documentos formais.

| Seção | Campos |
|---|---|
| Logo | **Enviar logo** ou **Trocar logo**: PNG, JPG, WEBP ou SVG, até 2MB. Vai no cabeçalho dos relatórios PDF |
| Identificação | **Nome (interno)** e **Razão social** (obrigatórios), **CNPJ** |
| Contato | **Email**, **Telefone** |
| Endereço | **Endereço**, **Cidade**, **CEP** |
| Inscrições fiscais | **Inscrição estadual**, **Inscrição municipal** |

Clique em **Salvar alterações**. O logo é salvo ao escolher o arquivo, sem precisar salvar o
resto.

### Contatos do bot

Quem pode mandar propostas e contratos pelo bot do Telegram. **Sem contato cadastrado, o bot não
aceita documentos de ninguém.**

**Cadastrar alguém:**
1. A pessoa escreve ao bot. Como não está cadastrada, o bot responde com um **código** (só
   números) e avisa o grupo da equipe.
2. A pessoa passa o código ao admin.
3. Em **Contatos do bot**, clique em **Novo contato**.
4. Preencha **Código do Telegram** (o número que o bot respondeu, ex.: 884349214) e **Nome** (nome
   e função, ex.: "Lúcio - comprador").
5. Clique em **Salvar**. A pessoa já pode mandar PDFs.

O formulário não pede obra: o sistema identifica a obra de cada documento lendo o próprio PDF.

**Editar:** o lápis da linha (só contatos de Telegram). **Excluir:** a lixeira; a pessoa deixa de
poder mandar propostas pelo bot.

| Mensagem | Quer dizer |
|---|---|
| "Informe o código que o bot enviou à pessoa" | Código vazio |
| "O código tem só números (ex.: 884349214)" | Há letra ou símbolo no código |
| "Esse código já está cadastrado" | O contato já existe na lista |

[tela: 25-contato-invalido.png] · [tela: 25b-contato-na-tabela.png]

### Meu perfil

Igual para todos os perfis: **Dados pessoais** (Nome e Telefone, **Salvar dados**) e **Trocar
senha** (Senha atual, Nova senha, Confirme a nova senha). O admin muda o próprio perfil pela aba
Usuários, como o de qualquer pessoa. O e-mail não muda por nenhuma tela.

[tela: 54-meu-perfil.png]

## Logs e auditoria

**Logs e auditoria**, no menu. Só o admin abre, e só o admin lê os eventos no banco.

Toda criação, edição, mudança de status e exclusão nas tabelas do sistema vira um evento, com quem
fez, quando, de onde e o que mudou. Os eventos não podem ser editados.

**Colunas:** **Quando**, **Origem**, **Resultado**, **Entidade** (com a referência, que abre o
registro quando há tela para ele), **Ação**, **Autor** e **Resumo**. Clique no resumo para abrir a
tabela **Campo / Antes / Depois**.

**Filtros:**

| Filtro | Opções |
|---|---|
| Busca | "Buscar na mensagem ou colar o id do registro" |
| Origem | Sistema, Automação, Banco (SQL direto) |
| Resultado | Sucesso, Erro |
| Entidade | Cliente, Orçamento, Obra, Proposta, Item, Contrato, Execução, Nota fiscal, Pagamento, Acordo de pagamento, Parcela de acordo, Faturamento direto, Documento da automação, Contato da automação, Usuário |
| Ação | Criação, Edição, Mudança de status, Exclusão |
| Autor | Os usuários da empresa |
| Período | Todos os períodos, Últimos 30 dias, Últimos 90 dias, Este ano |

São 20 eventos por página. Os filtros ficam no endereço: dá para mandar o link de uma busca.

**Usos comuns:**
- *Quem mudou este valor?* Cole o id do registro na busca, ou filtre a Entidade e abra o resumo.
- *O que deu errado hoje?* Resultado **Erro** e período.
- *O que o bot fez?* Origem **Automação**.

A NF tem também uma aba **Histórico** no detalhe, lida destes eventos. A automação tem o seu
próprio **Log da automação**, em Documentos.

[tela: 15-logs-busca.png] · [tela: 16-logs-diff.png] · [tela: 17-logs-390px.png]

## Relatórios e exportações

**Exportar XLSX** fica no topo das listagens de Obras, Orçamentos, Propostas, Contratos,
Execução, Faturamento Direto, Notas fiscais, Pagamentos e Acordos, e na Visão geral do Financeiro.
A planilha sai com os filtros aplicados na tela e traz a data de emissão, os filtros e o total de
registros.

**Relatórios PDF**, no detalhe da obra:

| Botão | Quem emite |
|---|---|
| **Relatório de medição (PDF)** | Admin, Medição, Financeiro |
| **Relatório FD (PDF)** | Admin, Financeiro, Visualizador |

Os dois levam o logo e os dados de **Configurações → Empresa**. Confira a Empresa antes do
primeiro relatório.

## Estornos e exclusões

A exclusão fica registrada em **Logs e auditoria** (ação **Exclusão**, com os valores de antes),
mas o registro some das telas.

**Estornar pagamento:** não há edição de pagamento. Para corrigir, o admin estorna (**Estornar**
→ confirmar no diálogo **Estornar pagamento?**) e o pagamento é registrado de novo. O status da NF
ou da parcela é recalculado; o pagamento avulso sai do total recebido da obra. Pagamento de NF
cancelada não é estornado: fica como histórico.

[tela: 40-estorno-dialogo.png]

**Excluir nota fiscal:** só sem pagamento e não cancelada.
- "Nota fiscal cancelada não é excluída: fica como registro"
- "Nota fiscal com pagamento não pode ser excluída; cancele, se for o caso"

**Não aceitar (documento do bot):** apaga o que o bot criou (a proposta ou o contrato) e devolve o
documento para revisão, com o motivo. Aceitar é também do comercial; recusar, só do admin.

[tela: 31-conferencia.png]

**Excluir cliente, obra, orçamento, proposta, item ou FD:** botão **Excluir** e confirmação.
[tela: 09-confirm-excluir.png]

## Telas

As telas entram no PDF a partir das screenshots da camada navegador (rodada de 2026-10-27); marcadores sem screenshot: nenhum. Neste manual entraram 15 telas.

## Pendências

- **Sem tela da aba Empresa, da lista de Usuários com a desativação nem do diálogo Não aceitar.** A
  camada navegador não grava essas telas. Não foram tiradas telas novas.
- **Nenhuma tela foi conferida contra este texto.** Os rótulos vêm do código; a conferência
  visual não foi feita.
- **Perfil das telas.** A conta principal da rodada (`VALIDACAO_EMAIL`) é admin: o roteiro marca
  os passos "como admin", e ela abre `/logs`, que só o admin abre. Só a 54 é de outro perfil (um
  comercial descartável); nela as abas de admin não aparecem.
- **Validade do link: 1 hora.** É o valor do gc-dev. O de produção não foi conferido; se mudar,
  este manual e a janela do link mudam junto.
- **E-mail.** O sistema não manda e-mail (SMTP próprio não configurado). Quando houver, convite e
  "Esqueci minha senha" podem passar a ir por e-mail, e as seções de Usuários mudam.
- **O primeiro admin** de um ambiente novo não é criado pela tela. É registro para quem for operar
  prod: ver `runbook-producao.md`.
- **Contato do suporte.** O manual diz "fale com o suporte", sem nome nem canal. Quem for
  distribuir completa.
- **As telas embutidas no PDF não foram conferidas contra o texto** (conferência visual não feita).
