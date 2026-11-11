import type { EstadoImportacao, PortasImportacao, RegistroImportacao } from "./portas.js";

const agoraIso = (portas: { agora(): number }) => new Date(portas.agora()).toISOString();

/**
 * Lê as issues abertas do repositório e aplica tudo numa só escrita: se a leitura falhar, nada muda no projeto. O
 * registro vai de `importando` a `ok` ou `erro`; um erro guarda a mensagem redigida e mantém o último resultado bom.
 */
export async function executarImportacao<Issue, Efeito>(
  portas: PortasImportacao<Issue, Efeito>,
  repoId: number,
): Promise<void> {
  const registro = (await portas.estado()).importacoes?.[String(repoId)];
  if (registro?.status !== "importando") return;
  const repo = registro.repo;
  try {
    const app = await portas.statusDoApp();
    if (!app.configurado || app.erro) throw new Error(app.erro ?? "GitHub App não configurado");
    const atual = await portas.repoDoApp(repoId);
    if (!atual) throw new Error(`${repo} não está mais no catálogo do App`);
    const projeto = portas.projetoDoRepo(atual.nome);
    if (!projeto) throw new Error(`nenhum projeto monitora ${atual.nome}`);
    const issues = await portas.issuesAbertas(atual.nome, atual.instalacaoId);
    let efeitos: Efeito[] = [];
    await portas.alterar((estado) => {
      const aplicado = portas.aplicar(estado, {
        projeto,
        repoId,
        repo: atual.nome,
        instalacaoId: atual.instalacaoId,
        issues,
      });
      efeitos = aplicado.efeitos;
      estado.importacoes = {
        ...estado.importacoes,
        [String(repoId)]: {
          repoId,
          repo: atual.nome,
          status: "ok",
          ultimaImportacaoEm: agoraIso(portas),
          installationId: atual.instalacaoId,
          ultimoResultado: aplicado.resultado,
        },
      };
    });
    await portas.executarEfeitos(efeitos);
  } catch (err) {
    await portas.alterar((estado) => {
      estado.importacoes = {
        ...estado.importacoes,
        [String(repoId)]: registroDeErro(estado, repoId, repo, err, portas),
      };
    });
  }
}

/** Registro de uma importação que falhou: mantém o último resultado bom e guarda a mensagem redigida. */
function registroDeErro<Issue, Efeito>(
  estado: EstadoImportacao,
  repoId: number,
  repo: string,
  err: unknown,
  portas: PortasImportacao<Issue, Efeito>,
): RegistroImportacao {
  const anterior = estado.importacoes?.[String(repoId)];
  return {
    repoId,
    repo,
    ...(anterior?.installationId !== undefined ? { installationId: anterior.installationId } : {}),
    status: "erro",
    ...(anterior?.ultimaImportacaoEm ? { ultimaImportacaoEm: anterior.ultimaImportacaoEm } : {}),
    ...(anterior?.ultimoResultado ? { ultimoResultado: anterior.ultimoResultado } : {}),
    ultimoErro: portas.redigir(err instanceof Error ? err.message : "falha desconhecida"),
  };
}
