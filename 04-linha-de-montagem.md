# Linha de montagem (implementação e entrega)

[← Índice](index.md)

## Implementação

| # | Etapa | Skill | O que acontece |
|---|-------|-------|----------------|
| 1 | Implementação | `tdd` | Implementa orientado a teste: primeiro o teste vermelho (falhando), depois o verde. Isso evita testes tautológicos ou ruins. |
| 2 | Revisão | `code-review` | Revisa o código. Se houver correção, volta para a implementação. |
| 3 | PR | — | Sem correções pendentes, abre o PR no GitHub. |
| 4 | CI | — | Pipeline roda. Se falhar, volta para a implementação. |
| 5 | Merge | — | CI verde. Merge manual (humano) ou auto-merge, conforme a configuração do projeto. |
| 6 | Retrospectiva | `retro` | Depois da implementação e da revisão, identifica melhorias. |

### Limite de voltas

Os retornos para a implementação (correção no review, falha no CI) **não podem virar um loop infinito**. Um loop sem fim gasta tokens sem parar e pode consumir todo o limite dos planos.

**Limite: 3 voltas.** Cada retorno é contado. Exemplo: implementação → review → implementação → review → implementação → review → implementação. Se precisar de mais uma volta depois da terceira, a fábrica barra o processo.

**Passou do limite, entra um humano.** Se o ciclo não fecha em 3 voltas, provavelmente o problema está na fábrica, e não só na issue. Por isso:

1. A fábrica para de trabalhar na issue.
2. Um humano é acionado e entra no loop para entender o que está acontecendo.
3. O humano decide o que fazer: rever a issue, destravar o trabalho ou abrir issues de melhoria (uma extensão, um hook, uma skill, a própria fábrica).

Esse é um dos dois casos em que a fábrica avisa alguém. O outro é o [limite de gerações de melhoria](05-auto-melhoria.md#limite-de-gerações-de-melhoria).

## Saída: PR pronto para aprovação

A fábrica conduz a issue até o **PR aberto, com CI verde e com todas as evidências** necessárias para um humano decidir.

O merge tem dois modos, configuráveis por projeto:

| Modo | Quem faz o merge | Resultado |
|------|------------------|-----------|
| **Manual** | Um humano revisa as evidências e faz o merge. | O último passo é humano. |
| **Auto-merge** | A própria fábrica, depois do CI verde. | A fábrica entrega direto em produção. |

## Encerramento da issue

Toda issue que sai da fábrica é **fechada e rotulada**. Ninguém é avisado: o rótulo e o motivo de fechamento já registram o que aconteceu.

No GitHub, uma issue fechada tem dois registros:

- **Motivo de fechamento**, nativo do GitHub: `completed` (concluída), `not planned` (não planejada) ou *duplicate* (duplicada, com link para a original).
- **Labels**, que podem ser adicionadas mesmo com a issue fechada.

| Situação | Motivo de fechamento | Label |
|----------|----------------------|-------|
| Concluída (PR com merge) | `completed`, automático quando o PR tem `Fixes #N` | `fabrica:concluida` |
| Rejeitada na segurança | `not planned` + conversa travada (`spam`) + autor bloqueado | `fabrica:rejeitada-seguranca` |
| Duplicada | *duplicate*, com link para a issue original | `fabrica:duplicada` |
| Já resolvida | `not planned`, com link para o que resolveu | `fabrica:ja-resolvida` |

As labels também alimentam o [loop externo](05-auto-melhoria.md#loop-externo-meta-engenharia--auto-melhoria): dá para contar quantas issues foram concluídas, rejeitadas ou duplicadas.

## Questões em aberto

- Quais são as "evidências" que o PR precisa trazer (testes, prints, logs, resumo da triagem)?
- Qual modo de merge é o padrão quando um projeto entra na fábrica?
- Se o merge for manual, a `retro` roda logo após o PR ou espera o merge?
- O limite de 3 voltas é contado separado para review e para CI, ou somando os dois?
- Além do número de voltas, deve existir um teto de tokens ou de custo por issue?
