# "Meu perfil" — status de entrega

Ajuste fora de bloco, feito na janela da Sprint 14 · Data: 2026-10-26 · Branch: `main` ·
Ambiente: gc-dev (`gzbmhgnpoehormnidmgg`)

---

## Resumo

**Validado:** a rodada completa (`caffeinate -ims npm run validar`, 2026-10-27) passa nas sete
camadas. Os números estão na seção Validação.

**O que faltava:** quem não era admin não tinha onde ver ou corrigir os próprios dados, nem trocar a
senha. Configurações era só do admin, e o menu do usuário no cabeçalho só tinha "Sair".

**Não há bloco no ClickUp** para este ajuste, então o documento leva nome descritivo.

## Como ficou

1. A aba **Meu perfil** (`/configuracoes/perfil`) abre para os seis perfis.
2. **Como se chega a ela:**
   - todo usuário, pelo menu do cabeçalho;
   - quem não é admin, também pelo item "Meu perfil" no rodapé da sidebar;
   - o admin, pela quarta aba de Configurações.
3. **O que a tela mostra:** o e-mail (login) e o perfil, só para leitura, e dois formulários:
   - **Dados pessoais:** nome e telefone, com a máscara de telefone já usada no painel de Usuários.
   - **Trocar senha:** pede a senha atual, a nova e a confirmação.

**Regras:**
- **A pessoa só edita a própria linha, pela própria sessão.** A action não usa a chave de serviço.
  A policy "Usuário edita próprio perfil" e o trigger `profiles_proteger` continuam valendo.
- **Perfil, situação e e-mail são só do admin.** O schema nem aceita esses campos: um `perfil` no
  payload é descartado antes do update. Se passasse, o trigger recusaria.
- **A senha atual é conferida no servidor**, com um login num cliente avulso, sem cookie. A sessão
  da pessoa não muda. O `secure_password_change` do Supabase pediria um código por e-mail, e o
  gc-dev não tem SMTP próprio, o mesmo motivo do "Esqueci minha senha".
- **Não houve migration.** A RLS e o trigger que já existiam bastaram.

**O que mudou no acesso a `/configuracoes`:** o layout passou a exigir só sessão. O guard de admin
desceu para as três páginas de admin:
- Empresa e Contatos do bot já tinham o guard próprio.
- Usuários ganhou o seu.

Quem não é admin vê só a aba Meu perfil. As actions de admin já repetiam a checagem por conta própria.

## Arquivos

| Arquivo | O quê |
|---|---|
| `src/app/(app)/configuracoes/perfil/page.tsx` | A tela. A query é `profiles.select('nome, email, telefone, perfil')` da própria linha |
| `src/app/(app)/configuracoes/perfil/actions.ts` | `atualizarMeuPerfil` e `trocarMinhaSenha` |
| `src/app/(app)/configuracoes/perfil/meu-perfil-panel.tsx` | Os dois formulários (react-hook-form + zod + toast) |
| `src/app/(app)/configuracoes/layout.tsx`, `abas.tsx`, `usuarios/page.tsx` | O guard sai do layout e vai para as páginas; as abas são filtradas por perfil |
| `src/lib/usuarios.ts` | `meuPerfilSchema`, `meuPerfilPayload`, `trocaSenhaSchema`, `mensagemDeErroSenha`. 3 testes novos |
| `src/lib/nav.ts`, `src/components/Sidebar.tsx`, `src/components/Header.tsx` | O item `PERFIL_ITEM`, o título da página e o link no menu do usuário |
| `src/app/convite/senha/definir-senha.tsx` | Passa a usar o `mensagemDeErroSenha` |

## O plano de validação, estendido

- **runtime** (`validacao-rotas.json` e `matriz-rls.json`):
  - 8 rotas: `/configuracoes/perfil` como admin e nos 5 perfis de teste, mais `/configuracoes` como
    comercial e como visualizador, que precisam dar 307;
  - `/configuracoes/perfil` como `"todos"` na varredura de URL direta.
- **dados:** 1 checagem. É a query do `page.tsx`, copiada, rodando como admin e como comercial. Cada
  um lê só a própria linha.
- **escrita:** bloco "s14 meu perfil", com 9 casos, sobre um usuário descartável
  `valida-perfil-<timestamp>@teste.com`:
  - nome vazio é recusado;
  - nome e telefone gravam;
  - `perfil: 'admin'` no payload não escala;
  - sem sessão, a action recusa;
  - senha curta é recusada;
  - senha atual errada é recusada;
  - com a troca válida, a senha nova entra e a antiga não;
  - a limpeza é conferida.
- **navegador:** passo 54, com 15 checagens:
  - link no menu do cabeçalho, abas e sidebar de quem não é admin;
  - zod do nome;
  - toast e nome novo no cabeçalho;
  - zod e erro de senha atual;
  - troca de senha e novo login.

  Screenshots: `54-meu-perfil.png`, `54-meu-perfil-390.png` e `54-meu-perfil-senha-zod.png`.

A senha do admin da validação e a dos usuários `@teste.com` não são tocadas, porque as outras camadas
entram com elas.

## Validação

Rodada final (`caffeinate -ims npm run validar`, 2026-10-27). A mesma rodada fecha o 14.1 aplicado ao
importador e a correção do progresso da obra.

| Camada | Resultado | Deste ajuste |
|---|---|---|
| sobras | nenhuma em gc-dev | — |
| estático | **limpo** (`tsc` + `next lint`) | — |
| unitário | **432 casos** | **3 casos novos** |
| build | **66 rotas**, iguais à baseline | **1 rota nova**: `/configuracoes/perfil` |
| runtime | **327/327 rotas** e **348 células** da varredura de URL direta | **8 rotas** e **6 células** |
| dados | **65/65 checagens** | **1 checagem** |
| escrita | **529/529 passos** | **9 passos** |
| navegador | **281/281 passos** | **passo 54**, 15 checagens; screenshots `54-meu-perfil*.png` |

**Rodadas:**
1. **26/10:** o gc-dev estava `INACTIVE`. Rodaram só estático, unitário e build.
2. **26/10:** falhou no runtime, 324/327. As 3 falhas vinham do seed de acordos, cujas datas tinham
   envelhecido: a parcela 2 do SEED-AC-004 venceu. `supabase/seed_acordos.sql` passou a realinhar os
   vencimentos a partir de hoje, como o seed de NF no 14.2.
3. **26/10:** falhou no build. Um agente criou `src/lib/conciliacao.ts` durante a rodada, e um
   `[...new Set()]` virou `Array.from`.
4. **26/10:** interrompida no build para a fase de execução da Sprint 14.
5. **27/10:** falhou na escrita, 1 caso: a limpeza do usuário descartável. Ele é autor de eventos
   de auditoria, e ao apagar o profile o `on delete set null` do `autor_id` esbarra no trigger
   `auditoria_imutavel`. Agora a escrita, o navegador e o `verificar-sobras.mjs` apagam esses
   eventos antes do usuário.
6. **27/10 — final:** passou nas sete camadas.

## Pendências

- **Conferência visual** no celular e no desktop: só pelas screenshots do passo 54; ninguém abriu a tela.
- **Outras sessões continuam abertas** depois da troca de senha. Não há o "sair de todos os
  dispositivos".
- **A troca de senha do admin real** nunca é exercitada pelo plano, de propósito.
- **Renomear muda o autor exibido** em históricos e logs antigos, que leem o nome pelo id. A
  auditoria guarda o valor anterior.
