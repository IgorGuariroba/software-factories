import { repoDoCatalogo } from "./catalogo.js";
import type { EfeitoProjeto, PortasProjetos, Resposta } from "./portas.js";

/**
 * Pedido de importação das issues abertas de um repositório do catálogo do App. Só aceita repositório com projeto
 * configurado, ativo e completo. Importar cria Tarefas, então projeto incompleto não importa (ADR-0022). Já em
 * importação, responde o registro atual sem enfileirar outra vez.
 */
export async function importarRepo(portas: PortasProjetos, repoId: number): Promise<Resposta> {
  const encontrado = await repoDoCatalogo(portas, repoId);
  if ("erro" in encontrado) return encontrado.erro;
  const { repo } = encontrado;
  const projeto = portas.projetoDoRepositorio(repo.nome);
  if (!projeto) {
    return {
      status: 409,
      body: { error: `nenhum projeto monitora ${repo.nome}; configure o projeto no YAML primeiro` },
    };
  }
  const pendencias = portas.pendenciasBloqueantes(projeto, await portas.estado.ler());
  if (pendencias.length > 0) {
    return { status: 409, body: { error: `projeto ${projeto} incompleto: ${pendencias.join("; ")}` } };
  }

  let resposta: Resposta = { status: 500, body: { error: "importação não registrada" } };
  let enfileirar = false;
  await portas.estado.alterar((state) => {
    if (portas.regras.repoDesativado(state, projeto)) {
      resposta = { status: 409, body: { error: `o repositório ${repo.nome} está desplugado` } };
      return;
    }
    if (portas.regras.projetoPausado(state, projeto)) {
      resposta = { status: 409, body: { error: `projeto ${projeto} pausado: retome-o para importar` } };
      return;
    }
    const atual = state.importacoes?.[String(repoId)];
    if (atual?.status === "importando") {
      resposta = { status: 202, body: atual };
      return;
    }
    const registro = {
      repoId,
      repo: repo.nome,
      status: "importando" as const,
      installationId: repo.instalacaoId,
      ...(atual?.ultimaImportacaoEm ? { ultimaImportacaoEm: atual.ultimaImportacaoEm } : {}),
      ...(atual?.ultimoResultado ? { ultimoResultado: atual.ultimoResultado } : {}),
    };
    state.importacoes = { ...state.importacoes, [String(repoId)]: registro };
    resposta = { status: 202, body: registro };
    enfileirar = true;
  });
  if (enfileirar) portas.importacao.enfileirar(repoId);
  return resposta;
}

/** Plugue: reativa um repositório já configurado. Não cria projeto: a configuração fica no YAML (ADR-0010). */
export async function plugarRepo(portas: PortasProjetos, repo: string): Promise<Resposta> {
  const projeto = portas.projetoDoRepositorio(repo);
  if (!projeto) return { status: 404, body: { error: `nenhum projeto monitora ${repo}; configure o YAML primeiro` } };
  await portas.estado.alterar((state) => {
    portas.regras.ativarProjeto({ state, project: projeto, repo });
  });
  return { status: 200, body: { ok: true, project: projeto, repo, status: "ativo" } };
}

/**
 * Desplugue: desativa o repositório de um projeto. Uma Tarefa ativa só para com `force`; sem ele, a resposta é 409 e
 * nada muda.
 */
export async function desplugarRepo(portas: PortasProjetos, repo: string, force: boolean): Promise<Resposta> {
  const projeto = portas.projetoDoRepositorio(repo);
  if (!projeto) return { status: 404, body: { error: `nenhum projeto monitora ${repo}` } };
  const ativas = portas.regras.tarefasAtivas(await portas.estado.ler(), projeto).map((t) => t.id);
  if (ativas.length > 0 && !force)
    return {
      status: 409,
      body: {
        error: "há Tarefa em execução neste repositório; confirme com force para cancelá-la",
        tarefasAtivas: ativas,
      },
    };
  let efeitos: readonly EfeitoProjeto[] = [];
  await portas.estado.alterar((state) => {
    efeitos = portas.regras.desativarProjeto({
      state,
      project: projeto,
      repo,
      motivo: "desplugado pelo usuário",
      force,
    }).effects;
  });
  await portas.efeitos.executar(efeitos);
  return { status: 200, body: { ok: true, project: projeto, repo, status: "desativado", tarefasCanceladas: ativas } };
}
