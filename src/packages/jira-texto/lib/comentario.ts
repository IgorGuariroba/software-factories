// Id de um comentário, em qualquer formato de resposta que o acli ou a API devolve.

/** Procura o id de um comentário criado em formatos variados de resposta (`{id}`, `{comment:{id}}`, `[{id}]`...). */
export function findCommentId(value: unknown, depth = 0): string | undefined {
  if (depth > 3 || !value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) return value.length === 1 ? findCommentId(value[0], depth + 1) : undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.id === "string" && v.id) return v.id;
  if (typeof v.id === "number") return String(v.id);
  for (const k of ["comment", "data", "result"]) {
    const id = findCommentId(v[k], depth + 1);
    if (id) return id;
  }
  return undefined;
}
