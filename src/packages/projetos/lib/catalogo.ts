import { type CatalogoRepo, catalogoDoApp } from "../../../github-app.js";
import type { PortasProjetos, Resposta } from "./portas.js";

/**
 * Repositório do catálogo do GitHub App, pelo id. Sem App configurado (ou com a consulta falha), a resposta é 409 com a
 * causa; repositório fora do catálogo, 404. Quem chama decide o que fazer com o repositório encontrado.
 */
export async function repoDoCatalogo(
  portas: Pick<PortasProjetos, "github">,
  repoId: number,
): Promise<{ repo: CatalogoRepo } | { erro: Resposta }> {
  const app = await portas.github.status();
  if (!app.configurado || app.erro)
    return { erro: { status: 409, body: { error: app.erro ?? "GitHub App não configurado" } } };
  const repo = catalogoDoApp(app).find((r) => r.id === repoId);
  if (!repo) return { erro: { status: 404, body: { error: `repositório ${repoId} não está no catálogo do App` } } };
  return { repo };
}
