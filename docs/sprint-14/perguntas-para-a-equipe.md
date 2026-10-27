# Sprint 14 — o que precisamos da equipe para começar

Sprint 14 — Migração da planilha e go-live · Mensagem enviada à equipe em 2026-10-12 ·
Respostas: anotar neste documento, no item de cada pergunta

---

Pessoal, a Sprint 13 (administração, qualidade e segurança) está fechada e validada. A Sprint 14 tira
os dados da planilha atual, passa para o sistema e coloca o sistema em produção. Para começar,
preciso de três coisas de vocês. Sem o item 1, a sprint não anda.

## 1. A planilha "Gestão Contratos.xlsx" (bloqueia tudo)

A planilha não está com a gente. Peço:

- **O arquivo original, atualizado e completo**, em .xlsx, com todas as abas: obras, propostas,
  itens, controle de execução, notas fiscais, pagamentos e extrato, FD e o resumo.
- **Por onde mandar:** anexo no card "14.1 Decisões de mapeamento da planilha" no ClickUp, ou link do
  Drive com acesso de leitura.
- **Quem está com ela hoje**, e se continua sendo preenchida. Se continua, precisamos combinar até
  quando (item 2.5).
- **A análise anterior.** O card diz que a planilha "já foi analisada" (8 obras, 24 propostas, 120
  itens, 287 linhas de execução, 9 notas fiscais, 7 pagamentos e 248 lançamentos de FD). Se alguém
  tem essa análise ou anotações, mande junto.

## 2. Cinco decisões sobre como os dados entram no sistema

São decisões de negócio, não técnicas. Entre parênteses, quem costuma saber responder.

1. **Clientes duplicados (comercial/administração):** a obra Estação Fashion aparece com três nomes
   de cliente: "Estação Fashion", "ESTAÇÃO FASHION" e "EF EMPREENDIMENTOS IMOBILIARIOS". São o mesmo
   cliente? Se houver outros casos parecidos, quem pode revisar a lista?
2. **Contratos (administração):** a planilha não tem aba de contratos. Confirmam que nada da planilha
   vira contrato no sistema e que os contratos serão cadastrados direto no sistema?
3. **Execução (produção). É a decisão crítica.**
   - **O problema:** a aba "Controle de Execução" só tem a quantidade fabricada, que está vazia, e a
     instalada. O sistema exige a ordem fabricado ≥ entregue ≥ instalado ≥ medido.
   - **A proposta:** tudo o que foi instalado conta como já fabricado e entregue, e a medição começa
     em zero.
   - **A pergunta:** a produção concorda? Se a medição já foi feita em alguma obra, como sabemos
     quanto?
4. **Os 32 links do Google Drive (administração):** 22 documentos de proposta, 7 comprovantes de
   pagamento e 3 notas de FD.
   - **(a) Manter só o link**, em texto. É mais rápido, mas o arquivo continua dependendo do Drive.
   - **(b) Baixar e guardar os arquivos no sistema.** Nesse caso, precisamos de acesso aos 32
     arquivos.
5. **Data de corte (administração):**
   - Até que data os lançamentos entram pela importação?
   - A partir de quando tudo passa a ser lançado só no sistema e a planilha fica somente para
     consulta?

## 3. Para o go-live em produção

- **Liberação do ambiente de produção:** hoje ele está pausado e fora do escopo de trabalho.
  Precisamos da autorização para trabalhar nele e de alguém com acesso à conta do Supabase para
  reativá-lo.
- **Janela de virada:** a sugestão é uma sexta à tarde. Qual data?
- **Usuários reais:** para cada pessoa, nome, e-mail, telefone e perfil. Os perfis são admin,
  comercial, financeiro, medição, produção e visualizador.
- **Domínio próprio:** qual endereço o sistema vai usar, e quem tem acesso para configurar o DNS?
- **Backup e monitoramento:**
  - O plano atual do Supabase tem backup automático diário? Se não tem, vamos contratar?
  - Para avisar quando der erro, a preferência é Sentry ou o próprio log da Vercel?
- **Valores de referência para a conferência:** o card traz R$ 627.959,83 de notas fiscais emitidas,
  R$ 489.498,13 recebidos e R$ 2.060.290,51 de FD a descontar. Esses números continuam valendo para
  a data de corte? Depois da importação, o sistema precisa fechar exatamente nesses totais.

## Ordem de prioridade

1. A planilha (item 1).
2. A decisão de execução (2.3) e a data de corte (2.5).
3. O restante.

Com a planilha em mãos, montamos o mapeamento e o script de importação e fazemos uma simulação, sem
gravar nada, enquanto as outras respostas chegam. A importação de verdade roda primeiro no ambiente
de testes e só vai para produção quando os totais baterem com a planilha.

Desde a mensagem, o script de importação já foi adiantado sem a planilha (ver `14.2-status-entrega.md`):
cada decisão acima virou uma regra isolada, fácil de trocar quando a resposta chegar.

## Respostas (2026-10-26)

Em 2026-10-26 o Breno avisou que a equipe não vai tomar estas decisões e delegou a escolha a uma
análise ("utilize agentes de raciocínio para tomar a melhor decisão de negócio"). As cinco decisões
do item 2 e as recomendações do item 3 foram decididas por análise, com o porquê, as alternativas
descartadas e o gatilho para rever cada uma, em `14.1-status-entrega.md`. A planilha (item 1) continua
faltando. Sobre o item 3, o Breno decidiu em 2026-10-26 que **a liberação do ambiente de produção não
será pedida**: ele não tem acesso, nada se faz em gc-prod, o go-live fecha como ensaio em gc-dev e
prod fica só como registro para quem for operar.
