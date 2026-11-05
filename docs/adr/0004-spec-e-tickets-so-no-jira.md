# SPEC e tickets vivem só no card, nunca no repositório

A SPEC e o checklist de tickets de cada tarefa ficam como dois comentários no card ("SPEC" e "Tickets"), editados no lugar. Não criamos subtarefas e não commitamos nenhum arquivo de spec no repositório do time. O MR contém só o código da mudança; a descrição dele leva o resumo, o link do card e o checklist de aceite. Assim o repositório do time não fica poluído com artefatos da fábrica, e o PO lê tudo onde já trabalha.

## Considered Options

- Arquivo de SPEC no repo: rejeitado, porque polui o repo do time e expõe o processo da fábrica no código.
- Subtarefas no Jira: rejeitado, porque poluem o board e os relatórios do time.
