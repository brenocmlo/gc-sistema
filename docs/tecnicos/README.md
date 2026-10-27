# docs/tecnicos

Documentos que **não** morrem junto com uma task: nota técnica, processo, auditoria. Levam
nome descritivo, nunca prefixo `m.n` — esse é reservado ao número do bloco no ClickUp e mora
em `docs/sprint-<N>/` (`docs/sprint-4/4.3-status-entrega.md` é a entrega do bloco 4.3).

Índice geral de `docs/` e as outras trilhas: `docs/README.md`.

| Documento | O que é |
|---|---|
| `plano-validacao.md` | as sete camadas de `npm run validar` e a regra de rodá-las antes de declarar qualquer task pronta |
| `auditoria-cobertura-sprint-4.md` | os modos de falhar do próprio plano de validação, entre eles o skip silencioso que fez três checagens de permissão pararem devolvendo exit 0. Leia antes de mexer nos scripts de validação |
| `correcoes-listagens-e-obras.md` | os três bugs achados ao fechar as lacunas de validação do bloco 4.3, e o que mudou no plano por causa deles |
| `runbook-producao.md` | o go-live e a operação do gc-prod, como registro (gc-prod fora do escopo por decisão do Breno em 26/10); o ensaio é feito em gc-dev nos blocos 14.4 e 14.5 |
| `manual-admin.md` | manual do perfil admin (bloco 15.1) |
| `manual-comercial.md` | manual do perfil comercial (bloco 15.1) |
| `manual-financeiro.md` | manual do perfil financeiro (bloco 15.1) |
| `manual-producao-medicao.md` | manual dos perfis de produção e medição (bloco 15.1) |
| `auditoria-repositorio-deploy-documentacao.pdf` | auditoria do repositório (anterior a esta série) |

**A regra de corte é a vida útil, não o nome.** Se o documento morre junto com a task, é
`docs/sprint-<N>/`. Se continua valendo depois, é daqui — mesmo que o nome cite uma sprint
só, que é o caso da `auditoria-cobertura-sprint-4.md`: o plano de validação ainda depende
dela. Pelo mesmo critério, `sprint-4-apresentacao-gestao.md` saiu daqui para
`docs/sprint-4/`: era o fechamento de uma sprint, e acabou com ela.
