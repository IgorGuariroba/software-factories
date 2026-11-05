# Papéis e ferramentas

[← Índice](index.md)

## Papéis

| Papel | Etapa | Responsabilidade |
|-------|-------|------------------|
| Juiz de segurança (Jev) | Triagem (passo 1) | Avalia se a issue ou o comentário tem prompt injection ou pedido malicioso. Rejeita a entrada insegura. |
| Verificação de saída | Loop externo | Confere se a issue para terceiros não leva conteúdo sensível antes de publicar. |
| Classificador molde/fábrica | Loop externo | Modelo inteligente que decide se a melhoria é do molde ou da fábrica. |
| Agente publicador | Loop externo | Publica as issues de melhoria. Antes, procura se já existe issue sobre o mesmo problema (abertas e fechadas) e decide: publicar, comentar, não publicar ou atualizar o componente. Registra na memória. |
| Distribuidor de modelos | Toda a fábrica | Modelo de topo de cadeia que decide qual modelo faz cada tarefa, pela complexidade e pela disponibilidade de cota. |
| Eu (autor da fábrica) | Segurança | Edito a lista de padrões de prompt injection. Marco falsos positivos. |
| Humano | Limite de voltas | Entra no loop quando um ciclo passa de 3 voltas. Investiga e decide: revê a issue, destrava o trabalho ou abre issues de melhoria. |
| Humano | Merge manual | Revisa as evidências do PR e faz o merge. |
| Humano | Qualquer etapa | Acompanha o que está acontecendo. Atende as notificações: destrava processo parado, aprova ações, avalia melhoria no limite de gerações. |
| Agente questionador | Triagem | Levanta causas, perguntas e alternativas de implementação. |
| Agente decisor | Triagem | Escolhe a melhor opção seguindo os critérios de decisão. |

## Padrões e ferramentas

- **Plataforma**: GitHub.
- **Entrada**: issues do repositório.
- **Conexão com os projetos**: GitHub App instalado em cada repositório.
- **Saída**: PR com evidências; merge manual ou auto-merge.
- **Agente**: pi, conectado a vários provedores de modelos.
