# Issue tracker: GitHub

As issues e especificações deste repo vivem como issues do GitHub (`IgorGuariroba/software-factories`). Use o CLI `gh` para todas as operações.

## Convenções

- **Criar issue**: `gh issue create --title "..." --body "..."`. Use heredoc para corpos com várias linhas.
- **Ler issue**: `gh issue view <número> --json number,title,body,labels,comments`.
- **Listar issues**: `gh issue list --state open --json number,title,body,labels,comments`, com os filtros `--label` e `--state` adequados.
- **Sub-issue de um pai**: `gh issue create --parent <pai> ...`, ou `gh issue edit <pai> --add-sub-issue <filho>` depois (`gh` 2.94+). Em `gh` mais antigo: `gh api --method POST repos/<dono>/<repo>/issues/<pai>/sub_issues -F sub_issue_id=<id-do-filho>` (id numérico do banco). Sem sub-issues, escreva `Part of #<pai>` no topo do corpo do filho.
- **Bloqueio**: dependências nativas de issues do GitHub. Adicione uma aresta com `gh issue create --blocked-by <n>,<n> ...` ou `gh issue edit <filho> --add-blocked-by <bloqueador>` (`gh` 2.94+). Em `gh` mais antigo: `gh api --method POST repos/<dono>/<repo>/issues/<filho>/dependencies/blocked_by -F issue_id=<id-do-bloqueador>`, usando o id numérico do banco (não o `#número` nem o `node_id`). Sem dependências, use uma linha `Blocked by: #<n>` no topo do corpo. Uma issue está desbloqueada quando todos os bloqueadores estão fechados.
- **Contar bloqueadores abertos**: `gh api repos/<dono>/<repo>/issues/<n> --jq .issue_dependencies_summary.blocked_by` (0 significa que pode começar).
- **Comentar**: `gh issue comment <número> --body "..."`.
- **Adicionar/remover rótulos**: `gh issue edit <número> --add-label "..."` / `--remove-label "..."`.
- **Fechar**: comente o motivo com `gh issue comment`, depois rode `gh issue close <número>`.

Infira o repo pelo `git remote -v`; o `gh` faz isso sozinho dentro do clone.

## Pull requests como superfície de triagem

**PRs como superfície de pedidos: não.** _(Mude para `sim` se este repo tratar PRs externos como pedidos de funcionalidade; o `/triage` lê este flag.)_

## Quando uma skill disser "publicar no issue tracker"

Crie uma issue no GitHub.

## Quando uma skill disser "buscar o ticket relevante"

Leia a issue como descrito em **Ler issue** acima.
