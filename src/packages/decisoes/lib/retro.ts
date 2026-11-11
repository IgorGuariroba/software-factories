import { partesDoId, projetoDe, SEM_REVISAO } from "./comum.js";
import type { PortasDecisoes, PublicacaoRetro, RespostaDecisao } from "./portas.js";

/** Trava das publicações de retrô: uma por vez, e nunca junto com a configuração do repositório. */
export interface TravasRetro {
  propostas: Set<string>;
  configurando: boolean;
}

/** Proposta de retrô da fábrica: prévia (GET) e publicação como issue (POST), com trava por proposta. */
export async function proposta(
  portas: PortasDecisoes,
  travas: TravasRetro,
  id: string,
  etapa: string,
  n: number,
  aprovar: boolean,
  corpo: unknown,
): Promise<RespostaDecisao> {
  const trava = `${id}/${etapa}/${n}`;
  if (travas.configurando || travas.propostas.has(trava) || (aprovar && travas.propostas.size > 0))
    return { status: 409, body: { error: "uma proposta já está sendo publicada; tente novamente" } };
  if (aprovar) travas.propostas.add(trava);
  try {
    const { projectName, cardKey } = partesDoId(id);
    const task = (await portas.estado()).tasks.find((t) => t.id === id);
    const retro = task?.retros?.find((r) => r.stage === etapa);
    const proposal = retro?.proposals?.find((p) => p.n === n);
    if (!task || !retro || !proposal || proposal.kind !== "fabrica")
      return { status: 404, body: { error: "proposta não encontrada" } };
    if (retro.status !== "concluida" || proposal.status !== "pendente" || !task.ref)
      return { status: 409, body: { error: "proposta não está disponível para revisão" } };
    const { sink, repo } = portas.retro();
    if (!sink || !repo) return { status: 409, body: { error: "repositório da fábrica não configurado" } };
    const projeto = projetoDe(portas, projectName);
    const publicacao: PublicacaoRetro = {
      writer: projeto.escritor,
      cardKey,
      config: projeto.configuracao,
      sink,
      repo,
      stage: retro.stage,
      ref: task.ref,
      proposal,
    };
    const previa = await portas.previsaoRetro(publicacao);
    if (!aprovar)
      return {
        status: 200,
        body: {
          title: previa.title,
          body: previa.body,
          revision: previa.revision,
          repo,
          dryRun: projeto.dryRun,
          blocked: previa.blocked,
        },
      };
    const dados = corpo as { revision?: unknown } | undefined;
    if (dados?.revision !== previa.revision) return SEM_REVISAO;
    if (previa.blocked)
      return { status: 409, body: { error: "texto ainda contém valores privados; publicação bloqueada" } };
    await portas.publicarRetro(publicacao, previa);
    await portas.alterar((estado) => {
      const atual = estado.tasks
        .find((t) => t.id === id)
        ?.retros?.find((r) => r.stage === etapa)
        ?.proposals?.find((p) => p.n === n);
      if (atual?.status === "pendente") Object.assign(atual, proposal);
    });
    return { status: 200, body: { ok: true, status: proposal.status, issue: proposal.issue } };
  } finally {
    if (aprovar) travas.propostas.delete(trava);
  }
}
