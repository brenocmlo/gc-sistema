# Manual do comercial · gc-sistema

Bloco 15.1 "Manual do usuário por perfil" · Guia do perfil **Comercial** · Escrito a partir do
código em 2026-10-26

---

## Para quem é

Para quem tem o perfil **Comercial**. Na tela Meu perfil, a descrição dele é: *"Clientes,
orçamentos, obras, propostas, contratos e documentos"*.

O caminho do dia a dia é **orçamento → proposta → contrato**. Cliente e obra vêm antes, porque a
proposta e o contrato pertencem a uma obra, e a obra pertence a um cliente.

| O comercial pode | Só o admin pode |
|---|---|
| Criar e editar cliente, obra, orçamento, proposta e contrato | Excluir cliente, obra, orçamento ou proposta |
| Mudar o status de orçamento, proposta e contrato | Recusar ("Não aceitar") o que o bot lançou |
| Gerar contrato de proposta aprovada | Cadastrar usuário, mudar e-mail ou perfil |
| Anexar arquivos e excluir **os próprios** anexos | Excluir anexo de outra pessoa |
| Enviar e revisar documentos, e aceitar o que o bot lançou | — |

## Como entrar e sair

**Entrar**

1. Abra o endereço do sistema. A tela de login pede **Email** e **Senha**.
2. Clique em **Entrar**. O sistema abre no **Dashboard**.

[tela: 01-login.png]

**Esqueci a senha**

1. Na tela de login, clique em **Esqueci minha senha**.
2. Informe o e-mail e clique em **Pedir novo acesso**.
3. O pedido vai para o administrador. Ele te manda um link para criar uma senha nova. O sistema
   não manda e-mail sozinho.

[tela: 53-esqueci-senha.png]

**Sair:** clique no seu nome, no canto de cima à direita, e em **Sair**.

## Meu perfil

Abra pelo seu nome no cabeçalho → **Meu perfil**, ou pelo item **Meu perfil** no rodapé do menu.

- **E-mail (login)** e **Perfil** aparecem só para leitura. Para mudar, fale com o administrador.
- **Dados pessoais:** **Nome** e **Telefone**. Clique em **Salvar dados**. O telefone é o que o
  administrador usa para mandar o link de acesso pelo WhatsApp.
- **Trocar senha:** **Senha atual**, **Nova senha** (ao menos 8 caracteres) e **Confirme a nova
  senha**. Clique em **Trocar senha**.

[tela: 54-meu-perfil.png] · [tela: 54-meu-perfil-senha-zod.png]

## O menu

| Item | O que tem |
|---|---|
| Dashboard | Funil comercial, suas pendências e atalhos |
| Clientes | Cadastro de clientes |
| Orçamentos | Pedidos de orçamento e o andamento deles |
| Obras | As obras de cada cliente |
| Propostas | Propostas com itens, condições de pagamento e status |
| Contratos | Contratos gerados de proposta ou criados avulsos |
| Documentos | PDFs recebidos pelo bot do Telegram ou enviados pela tela |
| Meu perfil | Seus dados e sua senha |

**O comercial não vê** Execução, Financeiro, Faturamento Direto, Logs e auditoria e
Configurações. Se abrir um desses endereços direto, o sistema volta para o Dashboard. Dentro de
uma obra, a aba **Financeiro** não aparece, e a aba **Execução** mostra o andamento sem o botão
de apontar.

No celular, o menu abre pelo botão de três traços no canto de cima à esquerda.

[tela: 14c-menu-390px.png]

### O Dashboard

- **Pendências:** só aparece o que tem quantidade, e cada linha abre a lista já filtrada:
  - Orçamentos aguardando análise;
  - Propostas enviadas com a validade vencida;
  - Documentos em revisão humana;
  - Documentos lançados a conferir.
- **Atalhos:** Novo orçamento, Nova proposta, Nova obra e Documentos recebidos.

[tela: 51-dashboard-comercial.png]

### As listagens

Todas funcionam igual: busca no topo, filtros de status e período (**Últimos 30 dias**, **Últimos
90 dias**, **Este ano**), 20 linhas por página e o botão **Exportar XLSX**, que baixa a lista com
os filtros aplicados.

[tela: 02-listagem.png]

## Tarefas do dia a dia

### 1. Cadastrar um cliente

1. **Clientes** → **Novo cliente**.
2. Preencha **Nome** (obrigatório). **CNPJ / CPF**, **Contato**, **Telefone**, **Email**,
   **Endereço**, **Cidade**, **CEP** e **Observação** são opcionais.
3. Clique em **Salvar cliente**.

### 2. Cadastrar uma obra

1. **Obras** → **Nova obra**.
2. Preencha **Código da obra** (ex.: "OBRA-2026-001"), **Nome** e **Cliente**.
3. Se quiser, preencha prazos e localização. **Data real de fim** fica em branco até concluir.
4. Clique em **Salvar obra**.

### 3. Registrar um orçamento

1. **Orçamentos** → **Novo orçamento**.
2. Escolha o **Cliente** e confira a **Data da solicitação**.
3. Preencha o que tiver: **Número**, **Descrição**, **Escopo resumo**, **Valor estimado (R$)**,
   **Prazo estimado**, **Responsável**, **Vincular a obra existente**, **Observações**.
4. Clique em **Salvar rascunho**.

**Andar com o orçamento:** abra o orçamento → **Mudar status** → escolha o **Novo status** →
**Salvar mudança**.

| Novo status | O que o sistema pede |
|---|---|
| Pendente, Em análise, Expirado | Nada |
| Enviado | **Data de envio** |
| Aprovado | **Data da decisão**. Opcional: marcar **Vincular a obra existente** e escolher a obra |
| Rejeitado | **Data da decisão** e **Motivo da rejeição**. Com o motivo "Outro (descrever)", os **Detalhes** são obrigatórios |

As abas **Anexos** e **Histórico** guardam os arquivos e cada mudança de status, com quem fez.

[tela: 11-orcamento-historico.png]

### 4. Montar uma proposta

1. **Propostas** → **Nova proposta**.
2. Preencha **Número** (único na empresa, ex.: PROP-2026-001), **Obra** e **Data de emissão**.
   O cliente da proposta é o cliente da obra.
3. Opcional: **Descrição**, **Validade**, **Valor total (R$)**, **Desconto (R$)**.
4. Preencha as parcelas em percentual: **Sinal (%)**, **FD (%)**, **Entrega de material (%)** e
   **Medição / instalação (%)**. A soma não pode passar de 100%.
5. O que não cabe em percentual vai em **Condições livres**.
6. Clique em **Salvar rascunho**.

[tela: 04-form-soma-invalida.png]

**Itens da proposta** (aba **Itens**, só enquanto a proposta é **Rascunho**):

- **Adicionar item** abre uma linha na tabela. **Adicionar com todos os campos** abre o
  formulário completo.
- **Importar planilha:**
  1. Clique em **Baixar itens-template.xlsx** e preencha. Área m² e Valor total não entram: o
     sistema calcula.
  2. Suba a planilha preenchida e confira a prévia.
  3. Clique em **Importar N itens**.
- Com itens, o **Valor total** da proposta passa a ser a soma deles e só muda pela aba Itens. Se
  aparecer diferença entre os dois, use **Usar a soma dos itens**.

[tela: 06b-aba-itens.png] · [tela: 06d-importar-preview.png]

### 5. Levar a proposta até a decisão

Abra a proposta → **Mudar status** → **Salvar mudança**.

| De | Para | O que o sistema pede |
|---|---|---|
| Rascunho | Enviada | **Data de envio** |
| Enviada | Aprovada | **Data da decisão** |
| Enviada | Rejeitada | **Data da decisão** e **Motivo da rejeição** |
| Enviada | Rascunho | Nada. É o caminho para corrigir |

- **Só rascunho é editável.** Para corrigir uma proposta enviada, volte para Rascunho, edite e
  envie de novo.
- **Aprovada e Rejeitada não mudam mais.** Para corrigir, crie uma proposta nova.
- Proposta enviada com a **Validade** passada ganha o selo **Vencida**.

[tela: 07-dialogo-status.png] · [tela: 08-aba-historico.png]

**Aditivo:** se a proposta é um acréscimo a um contrato da mesma obra, use o campo **Aditivo do
contrato** na aba Detalhes → **alterar** → escolha o contrato.

### 6. Gerar o contrato

1. Abra a proposta **Aprovada** → **Gerar contrato**.
2. Preencha o **Número** do contrato (ex.: CT-2026-001). A **Obra** vem travada na da proposta.
3. Confira datas, valores e parcelas. **Data de assinatura** pode ficar em branco até assinar.
4. Em **Itens e origem**, marque **Copiar os N itens da proposta** se o contrato for levar os
   itens. Com a cópia, o valor total do contrato é a soma deles. As fotos não vão junto.
5. Clique em **Gerar contrato**.

Se a proposta já gerou um contrato, o sistema pergunta **Gerar outro contrato desta proposta?**.
Confirme com **Gerar mesmo assim** só se for de fato um segundo contrato.

[tela: 19-gerar-contrato-form.png] · [tela: 20-gerar-contrato-confirmar.png]

**Contrato sem proposta:** **Contratos** → **Novo contrato** → **Criar contrato**.

### 7. Acompanhar o contrato

Abas: **Detalhes**, **Itens**, **Anexos**, **Histórico** e **Financeiro**.

| De | Para |
|---|---|
| Ativo | Suspenso, Concluído ou Rescindido |
| Suspenso | Ativo (retomada) ou Rescindido |
| Concluído, Rescindido | Não mudam mais |

- **Só contrato ativo é editável.** Suspenso: retome pelo "Mudar status" antes de editar.
- **Rescindido** pede o **Motivo da rescisão**. Com "Outro (descrever)", o **Detalhamento** é
  obrigatório.

[tela: 22-contrato-detalhe.png]

### 8. Anexar arquivos

Em orçamento, proposta e contrato, aba **Anexos**. Você exclui só o que você mesmo anexou. O
ícone de excluir não aparece nos anexos de outra pessoa.

[tela: 26-anexos-como-comercial.png]

### 9. Documentos recebidos (bot do Telegram ou tela)

**Enviar um PDF pela tela**

1. **Documentos** → **Enviar documento**.
2. **Obra** é opcional: em branco, o sistema identifica a obra lendo o PDF.
3. Escolha o **Arquivo PDF** (até 20 MB) → **Enviar**.
4. A leitura automática leva até 1 minuto.

**Status na lista**

| Status | O que fazer |
|---|---|
| Processando | Esperar |
| Faltam dados / Precisa de revisão | Abrir e usar **Resolver** |
| Registrado | Conferir a proposta ou o contrato criado |
| Descartado | Nada |

**Resolver** um documento:

- **Reprocessar:** roda a leitura de novo, podendo trocar a obra.
- **Vincular:** aponta para uma proposta ou contrato que a equipe já cadastrou à mão.
- **Descartar:** nada é gravado; diga o motivo (ex.: PDF duplicado).

**Conferir o que o bot lançou:** a proposta ou o contrato criado pela automação mostra a faixa
*"... criada pela automação — confira"*. Veja se os dados e os itens batem com o PDF e clique em
**Aceitar**. Se estiver errado, avise o administrador: **Não aceitar** é só dele.

[tela: 28-documentos.png] · [tela: 28b-documento-detalhe.png] · [tela: 31-conferencia.png]

## Erros comuns e o que fazer

| Mensagem | O que fazer |
|---|---|
| Email ou senha incorretos | Confira e tente de novo, ou use **Esqueci minha senha** |
| Seu acesso está desativado. Fale com o administrador. | Fale com o administrador |
| O link de acesso é inválido, já foi usado ou venceu. Peça um novo ao administrador. | Peça um link novo |
| Já existe uma proposta com esse número / Já existe um contrato com esse número | Use outro número |
| Já existe uma obra com esse código nessa empresa | Use outro código |
| A soma das parcelas é X% e não pode passar de 100%. | Ajuste os percentuais |
| Desconto não pode ser maior que o valor total | Reduza o desconto |
| Validade não pode ser anterior à emissão | Corrija a data de validade |
| Botão **Editar** cinza na proposta | Ela não é rascunho. Volte para Rascunho, ou crie outra se já tem decisão |
| Botão **Editar** cinza no contrato | Ele não está ativo. Retome pelo "Mudar status" |
| Só proposta aprovada gera contrato | Aprove a proposta antes |
| A soma dos itens da proposta é menor que o desconto. Reduza o desconto ou gere sem copiar os itens. | Siga a mensagem |
| O status mudou enquanto você decidia. Recarregue a página e tente de novo. | Recarregue a página |
| Nenhum cliente cadastrado ainda — cadastre um antes | Cadastre o cliente em **Clientes** |
| Nenhuma obra cadastrada ainda — cadastre uma antes | Cadastre a obra em **Obras** |
| Apenas admin pode excluir ... | Peça ao administrador |

## Quem procurar

| Assunto | Quem |
|---|---|
| Acesso, senha, e-mail ou perfil | Administrador |
| Excluir cliente, obra, orçamento, proposta ou anexo de outra pessoa | Administrador |
| Lançamento errado do bot | Administrador (**Não aceitar**) |
| Execução, medição | Produção / Medição |
| Notas fiscais, pagamentos, FD | Financeiro |

---

## Telas

As telas entram no PDF a partir das screenshots da camada navegador (rodada de 2026-10-27); marcadores sem screenshot: nenhum. Neste manual entraram 20 telas.

## Pendências

- **Nenhuma tela foi conferida contra este texto.** Os rótulos vêm do código; a conferência
  visual não foi feita.
- **A maior parte das telas não é do comercial.** Só 26, 51-dashboard-comercial e as 54 são
  gravadas com sessão de comercial. As outras usam a conta principal da rodada
  (`VALIDACAO_EMAIL`), cujo perfil não foi conferido. Se for admin, aparece também **Excluir**,
  e o menu tem itens que o comercial não vê.
- **Regra "uma obra, um contrato vigente".** Ainda não está na tela (ver
  `regra-um-contrato-por-obra.md`). Quando entrar, o passo 6 e a tabela de erros mudam.
- **"Criar nova obra a partir deste orçamento"** aparece no diálogo de status como "(em breve)".
  Ficou fora do manual.
- **Contato do administrador.** O manual diz "administrador", sem nome nem canal. Quem for
  distribuir completa.
- **As telas embutidas no PDF não foram conferidas contra o texto** (conferência visual não feita).
