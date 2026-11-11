// Helpers e tipos das definições de rota do adaptador: leitura de corpo e de escolhas, validações e a ação das Tarefas.
import type { EscolhasPessoas } from "../../../pessoas-fonte.js";
import type { FactoryCommands } from "./comandos.js";
import type { Pedido, Resposta, RespostaApi, Rota } from "./despacho.js";
import { ehJson } from "./guardas.js";

export type Manipulador = (pedido: Pedido, capturas: string[]) => Promise<RespostaApi>;

export interface Definicao {
  metodo: Rota["metodo"];
  caminho: string | RegExp;
  documentada: string;
  criar(comandos: FactoryCommands): Manipulador;
}

export const SEM_JSON: Resposta = { status: 415, body: { error: "envie Content-Type: application/json" } };
export const naoEhObjeto = (valor: unknown): boolean =>
  typeof valor !== "object" || valor === null || Array.isArray(valor);
export const decodificar = (captura: string | undefined): string => decodeURIComponent(captura ?? "");
/** Id da Tarefa a partir do projeto e da chave do card, como aparecem no caminho. */
export const idDe = (projeto: string | undefined, chave: string | undefined): string =>
  `${decodificar(projeto)}/${decodificar(chave)}`;

/** Escolhas de PO e tech lead do corpo da criação: texto vazio ou ausente vira "não escolhida". */
export function lerEscolhasPessoas(bruto: unknown): EscolhasPessoas | undefined {
  if (naoEhObjeto(bruto)) return undefined;
  const { po, techLead } = bruto as { po?: unknown; techLead?: unknown };
  const texto = (valor: unknown) => (typeof valor === "string" && valor.trim() !== "" ? valor.trim() : undefined);
  return { po: texto(po), techLead: texto(techLead) };
}

/** Comando de teste em argv: cada item precisa ter texto, e a lista vazia é válida (o projeto nasce incompleto). */
export function lerComando(bruto: unknown): string[] | undefined {
  const comando = Array.isArray(bruto) ? bruto.map((item) => (typeof item === "string" ? item.trim() : "")) : [];
  return comando.some((item) => item === "") ? undefined : comando;
}

export const HORARIO_INVALIDO = "horario: use business-hours (horário comercial) ou always (sempre ativo)";
export const COMANDO_INVALIDO = "comando de teste: cada argumento precisa ter texto";
export const REGEX_SEGREDO = /^[a-z0-9][a-z0-9-]{1,63}$/;
export const REGEX_REPO = /^[\w.-]+\/[\w.-]+$/;
export const ETAPAS_RETRO = "(triagem|spec|implementacao|review|mr|tarefa)";

/** Ação simples sobre a Tarefa (pausar, retomar, cancelar): 404 se a Tarefa não existe. */
export const acaoTarefa = (acao: "pause" | "resume" | "cancel"): Definicao => ({
  metodo: "POST",
  caminho: new RegExp(`^\\/tasks\\/([^/]+)\\/([^/]+)\\/${acao}$`),
  documentada: `/tasks/{project}/{key}/${acao}`,
  criar: (c) => async (_pedido, cap) => {
    const id = idDe(cap[0], cap[1]);
    return (await c[acao](id))
      ? { status: 200, body: { ok: true } }
      : { status: 404, body: { error: `Tarefa ${id} não existe` } };
  },
});

/**
 * Rotas do adaptador. Cada uma traduz o pedido em uma chamada a `FactoryCommands`; regra de estado fica no comando.
 */

/**
 * Rota que recebe JSON: sem `Content-Type: application/json`, responde 415 sem ler o corpo; com ele, entrega o corpo
 * lido ao manipulador. Concentra a regra que cada rota de escrita precisa.
 */
export function comJson(acao: (corpo: unknown, capturas: string[]) => Promise<RespostaApi>): Manipulador {
  return async (pedido, capturas) => {
    if (!ehJson(pedido.contentType)) return SEM_JSON;
    return acao(await pedido.corpo(), capturas);
  };
}
