# Sprint 4 — Módulo Propostas: o que foi entregue

Documento de apresentação. Data: 2026-09-14. Ambiente: **gc-dev**.
Código na `main` desde 2026-09-10 (PR #3, deploy de produção com status
*success*).

---

## Resumo em cinco linhas

A sprint 4 entregou o **módulo de Propostas completo**, do banco à tela: criar,
listar, buscar, filtrar, editar, mudar status com histórico, anexar arquivo,
exportar planilha e controlar quem pode fazer o quê. São **oito blocos, todos
concluídos**. No caminho, dois bugs que já estavam em produção foram descobertos
e corrigidos, e o projeto ganhou um **plano de validação automatizado** que hoje
exercita a aplicação inteira em sete camadas antes de qualquer entrega.

---

## 1. O que a sprint se propunha

Dois objetivos, um técnico e um de produto.

**Objetivo A — colocar o banco sob controle (bloco 4.1).** O projeto tinha dez
alterações de estrutura de banco aplicadas "na mão", sem registro de qual já
tinha entrado em qual ambiente. Isso torna qualquer mudança futura arriscada:
ninguém consegue afirmar com segurança o que está aplicado onde.

**Objetivo B — entregar Propostas (blocos 4.2 a 4.8).** Propostas era a única
área do sistema ainda em "Em construção". As outras duas equivalentes —
Orçamentos e Faturamento Direto — já estavam prontas, então o alvo era entregar
Propostas **no mesmo padrão**, não inventar um caminho novo.

---

## 2. O que foi entregue, bloco a bloco

| Bloco | O que se propunha | O que ficou pronto |
|---|---|---|
| **4.1** | Sincronizar o schema e pôr as migrations sob controle | As dez alterações viraram arquivos versionados e o histórico foi registrado na ferramenta oficial. Hoje o comando `migration list` mostra **13 de 13 alinhadas** em gc-dev |
| **4.2** | Base da entidade: tipos, regras puras e controle de acesso | `src/lib/propostas.ts` com as regras de negócio isoladas (status, percentuais, vencimento) — testáveis sem abrir o navegador — e o guard de perfil na rota |
| **4.3** | Tela de listagem | Busca por número, obra e cliente; filtros de obra, status e período; paginação de 20; estado todo na URL (link compartilhável) |
| **4.4** | Formulário de criação | Formulário em seções, com validação no cliente e no servidor, valor final calculado ao vivo e trava na soma dos percentuais de pagamento |
| **4.5** | Tela de detalhe e edição | Detalhe com seis abas, edição reusando o formulário do 4.4, exclusão com diálogo de confirmação |
| **4.6** | Mudança de status e motivo de rejeição | Fluxo `rascunho → enviada → aprovada/rejeitada` com diálogo que só oferece as transições válidas, e **histórico de quem mudou o quê e quando** |
| **4.7** | Anexos e exportação | Upload de arquivo com link temporário de visualização, e exportação XLSX que respeita os filtros aplicados na tela |
| **4.8** | Dados de teste e conferência nos perfis | 12 propostas de teste em gc-dev e a verificação de permissão **automatizada em seis perfis** |

---

## 3. O que avançou além do combinado

**Anexos chegaram duas semanas antes.** O plano previa um espaço reservado até o
bloco 4.7; a aba entrou funcional já no 4.5.

**Histórico de status virou padrão da casa.** Nasceu em Propostas e foi
estendido a Orçamentos, que antes não registrava nada. Hoje as duas telas usam o
mesmo componente — quem aprova ou rejeita fica registrado nos dois módulos.

**Dois bugs que já estavam no ar foram encontrados e corrigidos:**

1. **Erro ao navegar para uma página inexistente.** Abrir um link antigo, um
   favorito, ou estar na página 2 e alguém apagar registros fazia a tela mostrar
   uma faixa vermelha de erro de banco em vez de uma lista vazia. **Afetava as
   cinco listagens** do sistema, não só Propostas.
2. **A tela de Obras estava quebrada.** Um defeito antigo no cálculo de valores
   derrubava a listagem inteira por causa de uma única obra com contratos
   ativos. Pior: **ele ia se agravar com esta sprint** — passar a aprovar
   proposta pela tela ativaria o mesmo caminho, e a primeira aprovação feita pela
   interface derrubaria `/obras`. Corrigido antes de acontecer.

**O projeto ganhou um plano de validação automatizado.** Sete camadas, do mais
barato ao mais caro: compilação, testes de regra, build, a aplicação respondendo
com sessão real, consultas ao banco sob as regras de segurança, as operações de
escrita e, por fim, um navegador de verdade clicando na tela. É o que permite
afirmar "está pronto" com número, e não com impressão. Os dois bugs acima foram
achados exatamente por ele.

**Uma auditoria de cobertura fechou cinco pontos cegos** em 2026-09-10 — entre
eles três verificações de permissão que tinham parado de rodar silenciosamente.
Detalhe em `docs/tecnicos/auditoria-cobertura-sprint-4.md`.

---

## 4. Como conferir no sistema funcionando

O ambiente de conferência é o **gc-dev**, rodando localmente. O endereço da
Vercel existe e o deploy está verde, mas está protegido por login da Vercel e
aponta para o ambiente de produção, que segue pausado — por isso a conferência
se faz local, onde estão os dados de teste.

```bash
npm install
npm run dev        # abre em http://localhost:3000
```

Entre com o usuário administrador. Há **12 propostas de teste** já carregadas
(`PROP-2026-001` a `PROP-2026-012`), cobrindo os quatro status de propósito.

### Roteiro de 15 minutos

**1. Listagem — `/propostas`**
Digite `Alvorada` na busca: a lista filtra por **cliente**, que nem está na
tabela de propostas (chega pela obra). Troque o filtro de status para "Aprovada"
e note que **o endereço na barra muda junto** — esse link pode ser mandado para
outra pessoa e abre exatamente a mesma visão. Clique em **Exportar XLSX**: a
planilha que baixa respeita os filtros que estiverem aplicados.

**2. Vencimento — filtro "Vencidas"**
No seletor de status, escolha **Vencidas**. Aparece a `SEED-VENCIDA-001`
(validade em 21/08/2026). "Vencida" não é um status do banco: é calculado na
hora, e aparece igual na tela, no filtro e na coluna "Vencida" da planilha.

**3. Criar — botão "Nova proposta"**
Preencha valor total `1000` e desconto `100`: o **valor final vira 900 enquanto
você digita**. Agora coloque percentuais de pagamento que somem mais de 100% — a
tela avisa e **não deixa salvar**. A mesma regra é conferida de novo no servidor:
não adianta burlar pela tela.

**4. Detalhe e mudança de status**
Abra a proposta criada. Seis abas: Detalhes, Pagamento, Itens, Anexos, Histórico
e Financeiro. Clique em **Mudar status**: com a proposta em rascunho, o seletor
oferece **uma única opção** (Enviada), e o campo de data aparece já preenchido.
Salve e veja: o selo muda, o aviso de sucesso aparece, o botão Editar fica
desabilitado (proposta enviada não se edita) e a **aba Histórico passa a mostrar
"Rascunho → Enviada", com data, hora e o seu nome**.

**5. Anexos**
Na aba Anexos, suba um PDF. Ele aparece na lista com ícone, tamanho e data.
**Visualizar** abre por um link temporário de 1 hora — o arquivo não fica
público. **Excluir** pede confirmação.

**6. Permissões**
Peça a alguém com perfil **Comercial** para abrir a mesma proposta: verá "Mudar
status", **não verá "Excluir"**. Com perfil **Visualizador**: não verá nenhum dos
dois, e tentar abrir o endereço de edição direto **redireciona**. Com perfil
**Financeiro, Produção ou Medição**: "Propostas" nem aparece no menu.

> Os usuários de teste (`comercial@teste.com`, `visualizador@teste.com`, etc.)
> existem em gc-dev. Para entrar como um deles pela tela é preciso definir uma
> senha antes — a equipe técnica faz isso com um comando.

**7. A prova de que Obras foi consertada**
Abra `/obras`. Antes da sprint, essa tela mostrava uma faixa vermelha de erro.
`OBRA-2025-03` hoje calcula **R$ 364.968,57**, somando contratos e propostas
aprovadas (conferido no banco em 2026-09-14).

---

## 5. Como sabemos que está funcionando

A última execução completa do plano de validação, em **2026-09-10**, contra
gc-dev:

| O que foi verificado | Resultado |
|---|---|
| Compilação e padrão de código | limpo, sem alertas |
| Regras de negócio (testes) | **51 casos, 0 falhas** |
| Build da aplicação | **31 telas**, nenhuma sumiu |
| Telas abrindo com sessão real | **41 de 41** |
| Consultas ao banco sob regras de segurança | **12 de 12** |
| Operações de escrita (criar, editar, status, anexo, excluir) | **38 de 38** |
| Navegador clicando na tela de verdade | **24 de 24**, sem erro no console |

As operações de escrita rodam contra o banco real e **limpam o que criam**. O
roteiro de navegador deixa **13 imagens** de cada etapa, que servem de evidência.

---

## 6. O que não entrou, e o que vem depois

- **Itens da proposta** ficaram para a Sprint 5 — a aba existe com aviso na tela.
- **Ambiente de produção (gc-prod) segue pausado.** Tudo o que a sprint fez no
  banco está registrado e pronto para ser aplicado lá, com backup e janela, mas
  **não foi aplicado** — por decisão de escopo, não por pendência técnica.
- **Pontos de conferência que continuam manuais:** a leitura das imagens de
  evidência e a conferência visual fina das telas. O que é automatizável já está
  automatizado.
- **Risco aceito pelo responsável pela conta** em 2026-09-10: dois tokens de
  acesso e a senha do administrador de desenvolvimento não serão trocados, apesar
  de terem sido expostos em repositório público. Registrado em
  `docs/sprint-4/4.1-status-entrega.md`.

---

## Onde está o detalhe

| Documento | Conteúdo |
|---|---|
| `docs/sprint-4/4.1` a `docs/sprint-4/4.8-status-entrega.md` | um documento por bloco, com decisões e pendências |
| `docs/tecnicos/plano-validacao.md` | as sete camadas, o que cada uma prova e o que **não** prova |
| `docs/tecnicos/correcoes-listagens-e-obras.md` | os dois bugs encontrados e corrigidos |
| `docs/tecnicos/auditoria-cobertura-sprint-4.md` | a auditoria de cobertura de 2026-09-10 |
