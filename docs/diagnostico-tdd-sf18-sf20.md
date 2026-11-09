# Diagnóstico e reparos locais — SF-18 e SF-20

## Evidências

- SF-20: reproduzidas duas falhas em `test/implementacao.test.ts` (baseline e reinício). As fixtures dependiam de arquivos de controle externos ao workspace, invisíveis no sandbox restrito.
- Correção no clone SF-20: controles passam a usar `.git/` do clone temporário dos testes. Mantida execução real dos testes, sem liberar diretórios externos. Duas regressões e nove testes de sandbox passaram; suíte completa, typecheck e lint passaram.
- SF-18: teste de lint falhava por warning de non-null assertion. Corrigido com verificação explícita. Preservada a alteração já existente em `destinatarios-projeto.ts` que remove `throw` de `finally`. Tipo `EncaminhamentoTecnico` convertido de interface em alias compatível com estado JSON, sem casts. 446 testes passaram, typecheck e lint limpos.

## Correção no motor

`src/implement-stage.ts` reconhece uma fase RED já registrada que ficou GREEN por commits exclusivamente do formatador, em árvore limpa, com diff somente de espaços e suíte passando. Reutiliza o commit de estilo; não cria commit vazio. Alterações sem essa evidência continuam recusadas. Regressão em `test/tdd-format-recovery.test.ts`.

`src/test-diagnostic.ts` remove escapes de terminal e prioriza o detalhe da falha antes de truncar; eventos de recusa guardam diagnóstico maior. Testes em `test/test-diagnostic.test.ts`.

## Estado operacional

Nenhuma tarefa foi retomada, nenhum push ou publicação foi executado. Os reparos foram integrados pela nova operação explícita `GET/POST /tasks/{project}/{key}/repair`: prévia com revisão SHA-256, aprovação explícita inclusive dos ajustes em testes, validação da suíte e commit auditado como reparo humano, sem confundir a origem com TDD do modelo. A transação durável atualiza o checkpoint e registra `implementation.repairs`; a tarefa continua bloqueada até retomada explícita. A reconciliação recupera uma queda entre commit Git e checkpoint validando revisão e suíte.

Integração confirmada:
- SF-18, ticket 6: `07525059b39aabac932df3fbfe90b8c6ac1cd8c2`.
- SF-20, ticket 2: `75377209e4be684d9d2f7df19624c8b04f56da8d`.

Não houve edição direta do SQLite. A recuperação por formatação não substitui reparos semânticos de código/testes.

O typecheck e a suíte completa da fábrica passaram. O lint da raiz retorna sucesso com quatro warnings CSS existentes e duas sugestões de estilo nos testes novos, sem erros.
