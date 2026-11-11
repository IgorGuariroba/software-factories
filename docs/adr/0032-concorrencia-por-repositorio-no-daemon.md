# Concorrência no próprio daemon: uma Tarefa ativa por repositório

**Estado:** aceita, não implementada. Plano: [fase 5](../plano-evolucao-arquitetura.md#fase-5-paralelizar-se-a-medição-pedir), só se a medição justificar.

O escalonador ativa uma Tarefa por vez. As esperas por pessoa, veto e PR/MR já liberam a fila; o que segura as outras é só o trabalho ativo de modelo e de testes. Decidimos que, se a medição mostrar espera relevante, a fábrica passa a ter mais de uma Tarefa ativa no mesmo processo, sem executores separados.

- **Uma Tarefa ativa por repositório**, pela identidade canônica dele (o id do GitHub ou a URL normalizada do remoto), valendo entre projetos que o compartilham (ADR-0022).
- **Teto global** de Tarefas ativas, começando em duas.
- **Uma suíte de testes por vez** no host: chamadas de modelo correm em paralelo; CPU e memória, não.
- **Medir antes.** A fase só começa se o log de eventos mostrar Tarefas enfileiradas atrás de outra ativa por um tempo que compense.

## Considered Options

- Processos executores com IPC, leases e token crescente: rejeitado. A lease protege contra um executor que continua trabalhando depois de perder a vez; aqui os processos da jaula morrem com o daemon (ADR-0023) e só ele grava o estado.
- Paralelizar sem limite por repositório: rejeitado, porque duas Tarefas no mesmo repositório disputam base e branches.

## Consequências

- Depende da ADR-0031.
- Duas Tarefas no mesmo plano de modelos gastam a mesma cota mais depressa. O ganho real pode ser pequeno.
