# A retrô sai do caminho da entrega

**Estado:** aceita, não implementada. Plano: [fase 4](../plano-evolucao-arquitetura.md#fase-4-custo-e-prova).

Cada Tarefa passa hoje por até seis passos de retrô (triagem, SPEC, implementação, review, MR e a consolidada), cada um com uma chamada de modelo antes de a Tarefa seguir. Decidimos que a entrega não espera a retrô.

- **Métricas sempre**: tokens, chamadas, erros, duração, recusas e rodadas de review de cada etapa, calculados do trace e guardados na Tarefa.
- **Uma retrô por Tarefa**, em segundo plano, só quando houver sinal (recusas, rodada extra de review, CI vermelho, correção pedida por pessoa, bloqueio) ou por amostra.
- **Nada muda sozinho.** Proposta de conhecimento continua pedindo aprovação, e publicação pública continua com prévia (ADR-0024). Cada Tarefa registra a versão do conhecimento e dos prompts com que rodou, para comparar o antes e o depois.
- **`retroApproval` deixa de existir**, porque não há mais retrô entre etapas para segurar a Tarefa.

## Considered Options

- Manter a retrô por etapa: rejeitado, pelas chamadas no caminho crítico, a maioria em Tarefas sem nada a aprender.
- Avaliar toda mudança de prompt ou de conhecimento num conjunto de casos antes de promover: adiado. Por ora a comparação é pelas métricas das Tarefas reais, por versão.

## Consequências

- Uma Tarefa sem sinal e fora da amostra não gera retrô.
- Os passos de retrô continuam definidos na execução durável, sem fazer nada, para as Tarefas que estiverem neles quando a mudança entrar.
