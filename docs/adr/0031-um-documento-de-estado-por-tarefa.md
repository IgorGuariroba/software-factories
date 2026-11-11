# Um documento de estado por Tarefa

**Estado:** aceita, não implementada. Plano: [fase 5](../plano-evolucao-arquitetura.md#fase-5-paralelizar-se-a-medição-pedir), depois da medição.

Todas as Tarefas, inclusive as encerradas, ficam hoje num único documento durável, junto com a configuração dos projetos, e ele é regravado como base completa a cada alteração. Qualquer passo de qualquer Tarefa lê e reescreve o estado de todas. Decidimos que cada Tarefa tem o próprio documento, e que o documento da fábrica guarda só o que é global e um índice da fila.

- **Documento da Tarefa**: tudo o que hoje está no registro dela (entrega da SPEC, perguntas, progresso, review, publicação, registro de efeitos e métricas).
- **Índice da fila**: identidade, status, projeto, ordem e os campos que o escalonador lê.
- **Acesso por um pacote só.** Antes de trocar o armazenamento, todo o código passa a ler e alterar Tarefas pelo pacote `tarefa`.
- **Migração em um commit**, na subida, com cópia do banco antes.

## Considered Options

- Tabelas próprias no SQLite, ao lado do motor: rejeitado, porque perde o commit atômico junto com o checkpoint, que é o que torna a retomada segura.
- Manter o documento único e só arquivar as encerradas: rejeitado como solução final. Reduz o tamanho, mas mantém todas as Tarefas vivas no mesmo documento, que é o obstáculo para a ADR-0032.

## Consequências

- Listar Tarefas passa a ler o índice e, para os detalhes, um documento por Tarefa.
- O impacto do documento único não foi medido. A fase só começa depois da medição da fila.
