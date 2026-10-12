# Regra "uma obra, um contrato vigente" na tela · levantamento para a trilha de sprint

**Origem:** Breno, 25/09: *"uma obra pode ter mais de uma proposta e apenas um contrato"*. Ele
confirmou a regra também para a tela ("sim, desse jeito") e decidiu em 12/10 que **ela entra
pela trilha de sprint (opção b)**. Mexe em código, seed e testes dos blocos 6 a 9.

## O que já vale hoje

- **Pelo bot:** a rota `POST /api/ingestao/contrato` recusa com **409** o segundo contrato
  não rescindido da mesma obra. O documento vai para revisão ("pode ser aditivo ou reenvio").
- **Aditivo:** existe desde 12/10 como **proposta ligada ao contrato**
  (`propostas.contrato_aditivo_id`, decisão 32 da automação). É o caminho que a regra deixa no
  lugar do "segundo contrato".
- **Na tela, no banco e na função `gerar_contrato_de_proposta`:** nada impede.

## O rascunho da regra

Está em `~/gc-sistema-staging/regra-contrato/rascunho_contratos_um_por_obra.sql`, fora do
repositório de propósito: precisa de um número de migration novo e de ser aplicado junto com o
resto.

- **Forma:** trigger `BEFORE INSERT OR UPDATE OF status, obra_id` em `contratos`, que recusa
  quando já existe outro contrato não rescindido na mesma obra e empresa.
  - Usa um advisory lock por obra contra corrida.
  - O erro é `contrato_obra_ja_tem_vigente`, com o número do contrato existente no `detail`.
- **Por que trigger e não índice único:** os dados atuais violam a regra, e um índice não
  seria criado.

## O que quebra se a regra entrar sozinha

1. **Seed.** No gc-dev, em 12/10:

   | Obra | Contratos vigentes |
   |---|---|
   | OBRA-2025-03 | **7**: SEED-CT-001 (ativo), SEED-CT-EXEC (ativo), SEED-CT-002 (suspenso), SEED-CT-003 (concluído), TESTE-FASE2-001, 002 e 003 (ativos) |
   | OBRA-2026-001 | 1: SEED-CT-EXEC-45 |
   | BRA-2026-005 | 1: CT-2026-0042, do teste real da automação |

   O trigger não mexe no que existe, mas **trava qualquer mudança de status** desses contratos
   (ex.: reativar o SEED-CT-002), porque a obra já tem outros vigentes.
2. **Escrita (`validar-escrita.mjs`).** Os blocos 6.2, 6.3, 6.5, 7.x, 8.x e 9.x criam vários
   contratos na mesma obra do seed (`createContrato`, `gerarContratoDeProposta` e insert
   direto). Os blocos de status transitam contratos do seed.
3. **Navegador.** Os passos que criam ou mudam contrato nas obras do seed.
4. **Bloco 6.2, "gerar contrato de novo".** A função `gerar_contrato_de_proposta` tem
   `p_confirmar_duplicado`, que gera um segundo contrato da mesma proposta, e portanto na mesma
   obra. Com a regra, esse recurso **contradiz a regra**. Decisão de produto pendente:
   - removê-lo; ou
   - trocá-lo por "rescinda o atual para gerar outro".

## O que a trilha de sprint precisa fazer

1. **Decidir o destino do "gerar duplicado" da 6.2**, com o Breno.
2. **Redistribuir o seed:** um contrato vigente por obra, com obras de seed novas para os que
   sobram, ou rescindindo os excedentes.
3. **Escrita e navegador:** os blocos que criam contrato passam a criar **obras de teste
   próprias**, como já faz o bloco da rota de contrato da automação (`VALIDA-OA` e `VALIDA-OB`,
   com limpeza documentos → contratos → propostas → obras e rede de segurança).
4. **Aplicar o trigger,** com número de migration novo.
5. **Traduzir `contrato_obra_ja_tem_vigente`** em `mensagemDeErroContrato`, para a tela mostrar
   "A obra já tem o contrato X vigente. Rescinda o atual ou lance um aditivo".
6. **Passo novo na escrita:** segundo contrato na mesma obra → recusado, pela tela e pela
   função da 6.2.

## O que a automação já faz e não precisa mudar

A rota do bot já recusa o segundo contrato com 409 antes do insert. Com o trigger, ela continua
funcionando: o 409 da rota vem antes, e o trigger é a garantia no banco.
