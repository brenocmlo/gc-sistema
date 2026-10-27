# Manual do usuário — Produção e Medição

Parte do bloco [15.1 Manual do usuário por perfil](https://app.clickup.com/t/86e31aq43) · Guia dos
perfis **Produção** e **Medição** · Data: 2026-10-26 · Fonte: o código da branch `main` (telas,
regras e mensagens) e os documentos da sprint 8

---

## 1. Para quem é

Para quem aponta o andamento das obras: a fábrica, a equipe de entrega e instalação, e quem mede.

| Perfil | O que o sistema diz dele (tela Meu perfil) |
|---|---|
| **Produção** | "Aponta fabricação, entrega e instalação" |
| **Medição** | "Aponta a medição e gera o relatório de medição" |

Os dois abrem as mesmas telas e apontam no mesmo painel. A diferença que o sistema impõe é uma só:
**só a Medição emite o relatório de medição em PDF** (com o admin e o financeiro).

> **Atenção:** o sistema **não trava por etapa**. A Produção consegue gravar a medição, e a Medição
> consegue gravar a fabricação. A divisão da tabela acima é combinação da equipe, não regra da tela.
> Aponte só a sua parte.

## 2. Como entrar e sair

**Entrar**

1. Abra o endereço do sistema no computador ou no navegador do celular.
2. Preencha **Email** e **Senha** e toque em **Entrar**.
3. O sistema abre no **Dashboard**.

**Primeiro acesso.** Não existe cadastro pela tela. O administrador gera um **link de acesso** e
manda pelo WhatsApp; pelo link você cria a sua senha (ao menos 8 caracteres).

**Esqueci a senha**

1. Na tela de login, toque em **Esqueci minha senha**.
2. Digite o e-mail e toque em **Pedir novo acesso**.
3. A tela responde: "Pedido enviado. Se o e-mail tiver acesso ao sistema, o administrador vai te
   mandar um link para criar uma senha nova."
4. Espere o link do administrador. O sistema não manda e-mail.

**Sair.** Toque no seu nome, no canto de cima à direita, e em **Sair**.

## 3. O menu

[tela: 14-shell-390px.png] [tela: 14c-menu-390px.png]

| Item | Para quê |
|---|---|
| **Dashboard** | Seção de operação (progresso das obras), as suas pendências e os atalhos |
| **Obras** | Lista e detalhe das obras. Na obra, a aba **Execução** |
| **Execução** | Onde se aponta: uma obra por vez, todas as etapas de cada item |
| **Meu perfil** | Nome, telefone e troca de senha (seção 8) |

No celular o menu fica escondido: toque no botão de menu (três traços), no canto de cima à esquerda.

**Atalhos do Dashboard.** Produção: **Apontar execução** e **Obras**. Medição: **Apontar medição** e
**Obras**. Os dois levam à mesma tela, a `/execucao`.

**Pendências do Dashboard.** Aparece uma linha por obra com prazo vencido: "Execuções com prazo
vencido em <código da obra>". Tocar abre a Execução daquela obra, já filtrada em **Só atrasados**.
Sem atraso, a linha não aparece. [tela: 51-dashboard-producao.png] [tela: 51-dashboard-medicao.png]

## 4. Como a execução funciona

Cada **item de contrato** da obra tem uma ou mais **execuções**. Cada execução tem a sua quantidade
e passa por quatro etapas, nesta ordem:

**1. Fabricação → 2. Entrega → 3. Instalação → 4. Medição**

**A regra da cascata.** Cada etapa vai até o que a anterior já tem:

- a fabricação vai até a **quantidade da execução**;
- a entrega vai até o **fabricado**;
- a instalação vai até o **entregue**;
- a medição vai até o **instalado**.

E o contrário também vale: não dá para baixar uma etapa para menos do que a seguinte já tem. Se 10
foram entregues, a fabricação não volta para 8.

**Status de cada etapa** (calculado pelo sistema, não se escolhe):

| Status | Quando |
|---|---|
| **Pendente** | quantidade zero |
| **Em andamento** | acima de zero e abaixo da quantidade da execução |
| **Concluído** | chegou à quantidade da execução |

**Datas.** Também são do sistema: o **Início** é gravado na primeira vez que a etapa passa de zero;
o **Fim**, quando chega ao total. A **Previsão de fim** é a única data que você digita.

**Atraso.** A etapa está **Atrasada** quando a previsão de fim já passou e ela não foi concluída.
Vencer hoje ainda não é atraso.

## 5. Tarefas

### 5.1 Achar o que apontar

[tela: 27-execucao-obra.png] [tela: 31-vencimentos.png]

1. Abra **Execução** no menu.
2. Escolha a obra no primeiro campo. Sem obra escolhida, a tela mostra "Escolha uma obra".
3. Veja no topo o progresso das quatro etapas na obra e o quadro **Próximos vencimentos (7 dias)**.
4. Filtre se precisar: **Buscar pela descrição do item**, etapa (**Em fabricação**, **Em entrega**…),
   status, responsável, prazo (**Só atrasados**) e ordem (**Ordem: etapa mais atrasada**).
5. Toque em **Apontar** na linha do item (no celular, toque no cartão inteiro).

Também se chega pela obra: **Obras** → a obra → aba **Execução** → **Apontar** num dos itens mais
atrasados. O painel abre direto. [tela: 33-obra-aba-execucao.png]

### 5.2 Criar as execuções de uma obra nova

Só aparece quando há item de contrato sem execução.

1. Na Execução da obra, toque em **Criar execução para N itens**.
2. Confirme em **Criar**. Cada item ganha uma execução zerada, com a quantidade total do item.
3. A tela confirma: "N execuções criadas".

Se a obra não tem nenhum item de contrato, a tela diz "Nenhuma execução nesta obra". Execução só
nasce de item de **contrato vigente**: quem cadastra o contrato é o comercial.

### 5.3 Apontar uma etapa

[tela: 29-apontamento-datas.png] [tela: 31c-apontamento-390px.png]

1. Abra o painel do item (5.1). O título é o número e a descrição do item.
2. Na etapa, digite a **Quantidade (máx. N)**. O máximo já mostra o limite da cascata.
3. Para fechar a etapa de uma vez, toque em **Concluir etapa**: preenche com o máximo.
4. Preencha, se quiser, **Previsão de fim**, **Responsável** e **Observação**.
5. Toque em **Salvar apontamento**. A tela confirma "Apontamento salvo".

O painel grava **as quatro etapas juntas**. Dá para apontar fabricação e entrega no mesmo salvar,
desde que a cascata feche.

Quantidades aceitam até 3 casas decimais (metros, m², kg).

### 5.4 Medir

É a etapa **4. Medição** do mesmo painel (5.3). Ela vai até o **instalado**.

- Toda mudança na quantidade medida fica registrada com a data e quem apontou. É desse registro
  que sai o "medido no período" do relatório.
- **Corrigir uma medição para baixo** é permitido, e entra **negativo** no relatório do período em
  que a correção foi feita.

### 5.5 Gerar o relatório de medição (só Medição)

1. **Obras** → a obra → aba **Execução**.
2. No quadro do relatório, ajuste **De** e **Até**. O sistema sugere do dia 1 do mês até hoje.
3. Toque em **Relatório de medição (PDF)**. O botão mostra "Gerando PDF..." e o arquivo baixa.
4. A tela confirma "Relatório de medição baixado".

O PDF é para o cliente aprovar: por item, a quantidade contratada, o **medido no período**, o
**medido acumulado**, o valor unitário e os dois valores, os totais e o espaço para o aceite e as
assinaturas. A Produção não vê o botão.

### 5.6 Anexar fotos e documentos (evidências)

[tela: 32-evidencias.png]

Cada etapa do painel tem a área **Evidências**.

1. No computador: **Clique pra escolher** ou arraste o arquivo. No celular: **Tirar foto** abre a
   câmera traseira.
2. Aceita **PDF, JPG, PNG, WebP ou HEIC · até 20 MB por arquivo**.
3. A evidência grava **na hora**, sem precisar do **Salvar apontamento**.
4. Toque na miniatura para abrir o arquivo em outra aba. PDF e HEIC aparecem como ícone com o nome.

**Excluir:** o ícone da lixeira na miniatura → **Excluir**. Só quem enviou o arquivo, ou o admin,
pode excluir. A exclusão é permanente.

### 5.7 Dividir um item em mais de uma execução

Para itens feitos em partes (Torre A e Torre B, um pavimento por vez).

1. No painel da primeira execução, baixe a **Quantidade desta execução** e preencha a
   **Localização (ex.: Torre A - 3º pavimento)**. **Salvar apontamento**.
2. Abra de novo e toque em **Nova execução deste item**. O painel mostra quanto sobra.
3. Preencha **Quantidade** e **Localização** e toque em **Criar execução**.
4. A tela confirma "Execução 2 criada". Na lista ela aparece como "↳ Execução 2 de 2".

[tela: 30-varias-execucoes.png]

### 5.8 Exportar a planilha

Na Execução da obra, **Exportar XLSX** baixa as linhas com os filtros que estiverem na tela.

## 6. No celular

Tudo o que está acima funciona no navegador do celular. O que muda:

- a lista vira **um cartão por execução**, com as quatro etapas em grade; o cartão inteiro abre o
  painel; [tela: 31b-execucao-390px.png]
- o painel ocupa a **tela inteira**, e **Cancelar** e **Salvar apontamento** ficam fixos embaixo;
- cada etapa tem **Tirar foto**;
- o menu abre pelo botão de três traços.

Com sinal fraco, espere a miniatura aparecer antes de fechar o painel: é ela que mostra que o
arquivo gravou.

## 7. Erros comuns

As mensagens abaixo são as da tela, copiadas do código.

| Mensagem | O que significa | O que fazer |
|---|---|---|
| "Só é possível entregar 12 porque só 12 foram fabricados" (e as variações por etapa) | a cascata: a etapa passou da anterior | aponte primeiro a etapa anterior, no mesmo salvar se quiser |
| "Não é possível instalar porque nenhuma unidade foi entregue" | a etapa anterior está em zero | idem |
| "Não é possível baixar a fabricação para 8: já foram entregues 10" | a etapa seguinte já tem mais | corrija primeiro a etapa seguinte |
| "Só é possível fabricar N: é a quantidade total do item" | a fabricação passou da quantidade da execução | confira a quantidade; se o item cresceu, quem muda é o comercial |
| "Use no máximo 3 casas decimais" | quantidade com 4 casas ou mais | arredonde |
| "A previsão de entrega não pode ser antes da de fabricação" | previsões fora de ordem | as previsões seguem a ordem das etapas |
| "Esta execução foi apontada por outra pessoa enquanto você editava. A linha foi recarregada — confira antes de repetir." | duas pessoas no mesmo item | confira o que a outra gravou e aponte de novo |
| "Só cabem N nesta execução: o item tem X e as outras execuções já somam Y" | dividir o item passou do total | reduza outra execução antes |
| "Já foram fabricados N nesta execução; a quantidade dela não pode ficar abaixo disso" | reduzir a execução abaixo do fabricado | não dá: a fabricação já ocupou essa quantidade |
| "Só item de contrato vigente recebe execução" | contrato rescindido ou item sem contrato | fale com o comercial |
| "O arquivo passa de 20 MB" / "Tipo de arquivo não aceito" | a evidência fora da regra | reduza a foto ou mande PDF/JPG/PNG/WebP/HEIC |
| "Só o admin ou quem enviou o arquivo pode excluí-lo" | excluir evidência de outra pessoa | peça a quem enviou ou ao admin |
| "A data inicial é depois da final" | período do relatório invertido | troque **De** e **Até** |
| "Email ou senha incorretos" | login | confira; se esqueceu, **Esqueci minha senha** |
| "Seu acesso está desativado. Fale com o administrador." | usuário desativado | fale com o administrador |
| "O link de acesso é inválido, já foi usado ou venceu. Peça um novo ao administrador." | link de acesso velho | peça outro |

## 8. Meu perfil

[tela: 54-meu-perfil.png] [tela: 54-meu-perfil-390.png]

Pelo menu (**Meu perfil**) ou pelo seu nome no canto de cima → **Meu perfil**. Mostra o
**E-mail (login)** e o **Perfil**, que só o administrador muda.

**Mudar nome ou telefone**

1. Em **Dados pessoais**, edite **Nome** (ao menos 2 caracteres) e **Telefone** (opcional, no
   formato (XX) XXXXX-XXXX). O telefone é o que o administrador usa para mandar o link pelo WhatsApp.
2. Toque em **Salvar dados**. A tela confirma "Dados atualizados".

**Trocar a senha**

1. Em **Trocar senha**, preencha **Senha atual**, **Nova senha** (ao menos 8 caracteres) e
   **Confirme a nova senha**.
2. Toque em **Trocar senha**. A tela confirma "Senha trocada". Você continua conectado.

Erros dessa tela: "Senha atual incorreta", "As senhas não conferem", "A nova senha precisa ser
diferente da atual", "Muitas tentativas. Espere alguns minutos e tente de novo". Esqueceu a atual?
Saia e use **Esqueci minha senha** na tela de login. [tela: 54-meu-perfil-senha-zod.png]

## 9. Quem procurar

| Assunto | Quem |
|---|---|
| Acesso, senha, link de acesso, mudar perfil ou e-mail | o **administrador** da empresa (perfil Admin) |
| Item que falta, quantidade do item errada, contrato rescindido | o **comercial**, que cadastra contrato e itens |
| Valor unitário errado no relatório | admin ou **financeiro**: só eles alteram o valor unitário |
| Execução criada por engano | o **administrador**: a tela não tem botão de excluir execução, e o banco só deixa o admin excluir |
| Erro que não está na seção 7 | o administrador, com a mensagem exata e a obra |

## Telas

As telas entram no PDF a partir das screenshots da camada navegador (rodada de 2026-10-27); marcadores sem screenshot: nenhum. Neste manual entraram 15 telas.

## Pendências

- **Telas que a camada navegador não tira:** o relatório de medição (o download é conferido pela
  escrita) e o **Tirar foto** com a câmera aberta. Não há screenshot.
- **Divisão por etapa:** confirmar com a equipe se "Produção aponta fabricação, entrega e
  instalação; Medição aponta a medição" é regra a ser travada no sistema ou só combinação. Hoje
  não é travada (seção 1).
- **Nomes em "Quem procurar":** o manual cita perfis, não pessoas. Falta a equipe dizer quem é o
  administrador e o comercial de referência.
- **Endereço do sistema em produção:** não citado, porque o ambiente de produção não está no
  escopo deste trabalho.
- **Conferência com usuário real:** ninguém da produção ou da medição leu este guia ainda.
- **As telas embutidas no PDF não foram conferidas contra o texto** (conferência visual não feita).
