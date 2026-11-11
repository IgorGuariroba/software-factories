import { ProjectConfig } from "../../../config.js";
import { aguardandoConfirmacao, comConfirmacaoPendente, trocouFonteOuRepositorio } from "../../../projeto-fonte.js";
import { projetoPausado } from "../../../projeto-pausa.js";
import {
  camposAlterados,
  estadoDoProjeto,
  lerConfiguracao,
  pendenciasDeConfiguracao,
} from "../../config-store/index.js";
import { validarPerfis } from "../../profiles/index.js";
import type { PortasConfiguracaoProjeto, RespostaConfiguracao } from "./portas.js";

const NAO_EXISTE = (nome: string): RespostaConfiguracao => ({
  status: 404,
  body: { error: `projeto ${nome} não existe` },
});

type EstadoLido = Awaited<ReturnType<PortasConfiguracaoProjeto["estado"]>>;

/** Estado atual e configuração guardada de um projeto; ou a resposta 404 se ele não existe. */
async function lerProjeto(
  portas: PortasConfiguracaoProjeto,
  nome: string,
): Promise<{ atual: EstadoLido; guardada: ProjectConfig } | { erro: RespostaConfiguracao }> {
  const atual = await portas.estado();
  const guardada = lerConfiguracao(atual.projetos?.[nome]);
  return guardada ? { atual, guardada } : { erro: NAO_EXISTE(nome) };
}

/** Pendências e estado do projeto no estado dado, com a confirmação da Fonte quando houver troca em aberto. */
function situacaoDo(atual: EstadoLido, guardada: ProjectConfig, nome: string) {
  const pendencias = comConfirmacaoPendente(pendenciasDeConfiguracao(guardada), atual, nome);
  return { estado: estadoDoProjeto(pendencias, projetoPausado(atual, nome)), pendencias };
}

/** Pendências da configuração guardada, com a da confirmação da Fonte quando houver troca em aberto. */
export async function pendencias(portas: PortasConfiguracaoProjeto, nome: string): Promise<RespostaConfiguracao> {
  const lido = await lerProjeto(portas, nome);
  if ("erro" in lido) return lido.erro;
  return { status: 200, body: comConfirmacaoPendente(pendenciasDeConfiguracao(lido.guardada), lido.atual, nome) };
}

/** Estado do projeto: ativo, pausado ou com pendências, e se aguarda confirmação da Fonte. */
export async function estado(portas: PortasConfiguracaoProjeto, nome: string): Promise<RespostaConfiguracao> {
  const lido = await lerProjeto(portas, nome);
  if ("erro" in lido) return lido.erro;
  return {
    status: 200,
    body: {
      ...situacaoDo(lido.atual, lido.guardada, nome),
      aguardandoConfirmacao: aguardandoConfirmacao(lido.atual, nome),
    },
  };
}

/**
 * Confirma a Fonte nova: tira só a pendência da troca. O projeto vira ativo se não houver outras pendências (e não
 * estiver pausado).
 */
export async function confirmarFonte(portas: PortasConfiguracaoProjeto, nome: string): Promise<RespostaConfiguracao> {
  const lido = await lerProjeto(portas, nome);
  if ("erro" in lido) return lido.erro;
  await portas.alterar((estado) => {
    estado.projetosAguardandoConfirmacao = (estado.projetosAguardandoConfirmacao ?? []).filter((p) => p !== nome);
  });
  // Relido depois da alteração: a pendência da troca já saiu, e o estado mostra o que ficou.
  const atual = await portas.estado();
  return {
    status: 200,
    body: { ...situacaoDo(atual, lido.guardada, nome), aguardandoConfirmacao: false },
  };
}

/** Histórico de alterações. Depois da remoção continua consultável. */
export async function historico(portas: PortasConfiguracaoProjeto, nome: string): Promise<RespostaConfiguracao> {
  const estado = await portas.estado();
  const existe = lerConfiguracao(estado.projetos?.[nome]) !== undefined || nome in (estado.projetosRemovidos ?? {});
  if (!existe) return NAO_EXISTE(nome);
  return { status: 200, body: estado.historicoConfig?.[nome] ?? [] };
}

/** Configuração guardada do projeto. */
export async function configuracao(portas: PortasConfiguracaoProjeto, nome: string): Promise<RespostaConfiguracao> {
  const lido = await lerProjeto(portas, nome);
  return "erro" in lido ? lido.erro : { status: 200, body: lido.guardada };
}

/**
 * Salva a configuração de um projeto. Valida o formato, o nome, os perfis, os caminhos e a Fonte antes de gravar. Trocar a
 * Fonte ou o repositório só vale sem Tarefas em andamento (nada é gravado se houver) e deixa o projeto aguardando a
 * confirmação. Cada campo alterado vai para o histórico.
 */
export async function salvar(
  portas: PortasConfiguracaoProjeto,
  nome: string,
  corpo: unknown,
): Promise<RespostaConfiguracao> {
  const lida = ProjectConfig.safeParse(corpo);
  if (!lida.success)
    return {
      status: 400,
      body: { error: lida.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
    };
  if (lida.data.name !== nome) return { status: 400, body: { error: "o nome do projeto no corpo não bate com a URL" } };
  const errosPerfis = validarPerfis({ profiles: lida.data.profiles, people: lida.data.people });
  if (errosPerfis.length > 0) return { status: 400, body: { error: errosPerfis[0] } };
  for (const repositorio of lida.data.repositories ?? []) {
    if (!(await portas.ehDiretorio(repositorio.path)))
      return { status: 400, body: { error: `caminho do repositório não existe: ${repositorio.path}` } };
  }
  const erroFonte = await portas.erroDaFonte(lida.data.source);
  if (erroFonte) return { status: 400, body: { error: erroFonte } };

  let existe = false;
  let emAndamento: string[] = [];
  await portas.alterar((estado) => {
    const anterior = lerConfiguracao(estado.projetos?.[nome]);
    if (!anterior) return;
    existe = true;
    // Trocar a Fonte ou o repositório só sem tarefas em andamento: nada é gravado se houver.
    if (trocouFonteOuRepositorio(anterior, lida.data)) {
      emAndamento = portas.tarefasEmAndamento(estado, nome);
      if (emAndamento.length > 0) return;
      estado.projetosAguardandoConfirmacao = [...new Set([...(estado.projetosAguardandoConfirmacao ?? []), nome])];
    }
    estado.projetos = { ...estado.projetos, [nome]: JSON.stringify(lida.data) };
    const campos = camposAlterados(anterior, lida.data);
    if (campos.length > 0)
      estado.historicoConfig = {
        ...estado.historicoConfig,
        [nome]: [
          ...(estado.historicoConfig?.[nome] ?? []),
          { quando: new Date(portas.agora()).toISOString(), autor: "usuario", campos },
        ],
      };
  });
  if (!existe) return NAO_EXISTE(nome);
  if (emAndamento.length > 0)
    return {
      status: 409,
      body: {
        error: `há tarefas em andamento no projeto ${nome}: conclua ou cancele-as para trocar a Fonte ou o repositório`,
        tarefasEmAndamento: emAndamento,
      },
    };
  portas.aplicar(lida.data);
  return { status: 200, body: lida.data };
}
