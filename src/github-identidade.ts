import type { ImportacaoRepo, QueuedTask } from "./durable.js";

/**
 * Identidade estável das issues importadas do GitHub (plano de migração, Fase 1). Usa os ids numéricos do GitHub, e não
 * o nome `dono/repo` nem o número da issue sozinho: um repositório renomeado ou transferido continua sendo o mesmo, e o
 * número `#12` de dois repositórios diferentes não colide.
 */

/** Chave de unicidade de uma issue: `<repoId>#<issueNumber>`. Só para comparação interna; não sai para a interface. */
export const chaveIssue = (repoId: number, issueNumber: number): string => `${repoId}#${issueNumber}`;

/**
 * Tarefa já importada para esta issue, se houver. Tarefas sem `origem` (criadas por YAML ou pela busca antiga) nunca
 * casam: a importação não as reaproveita, para não misturar identidades.
 */
export function tarefaDaIssue(
  tasks: readonly QueuedTask[],
  repoId: number,
  issueNumber: number,
): QueuedTask | undefined {
  return tasks.find(
    (t) => t.origem !== undefined && t.origem.repoId === repoId && t.origem.issueNumber === issueNumber,
  );
}

/**
 * Índice das issues já importadas, por `chaveIssue`. Se o estado tiver duas Tarefas para a mesma issue (dado corrompido
 * ou corrida antiga), a primeira na ordem da fila prevalece e a duplicata aparece em `duplicadas` para revisão.
 */
export function indiceIssues(tasks: readonly QueuedTask[]): {
  porChave: Map<string, QueuedTask>;
  duplicadas: string[];
} {
  const porChave = new Map<string, QueuedTask>();
  const duplicadas: string[] = [];
  for (const task of tasks) {
    if (!task.origem) continue;
    const chave = chaveIssue(task.origem.repoId, task.origem.issueNumber);
    if (porChave.has(chave)) duplicadas.push(task.id);
    else porChave.set(chave, task);
  }
  return { porChave, duplicadas };
}

/** Registro de importação de um repositório; `undefined` quando ele nunca foi importado (equivale a status `nunca`). */
export function importacaoDoRepo(
  importacoes: Record<string, ImportacaoRepo> | undefined,
  repoId: number,
): ImportacaoRepo | undefined {
  return importacoes?.[String(repoId)];
}
