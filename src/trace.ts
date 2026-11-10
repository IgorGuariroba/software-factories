import { redactSecrets } from "./secrets.js";

/** Um passo do trace de uma execução de etapa, já pronto para a interface. */
export type PassoDoTrace =
  | { tipo: "usuario"; texto: string; quando?: number }
  | { tipo: "agente"; texto: string; uso?: { entrada: number; saida: number }; quando?: number }
  | { tipo: "chamada"; ferramenta: string; argumentos: unknown; quando?: number }
  | { tipo: "resultado"; ferramenta: string; resultado: string; erro: boolean; quando?: number };

type Bloco = Record<string, unknown>;
type Mensagem = Record<string, unknown>;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** O texto de um conteúdo que pode ser uma string ou uma lista de blocos de texto. */
function textoDe(conteudo: unknown): string {
  if (typeof conteudo === "string") return conteudo;
  if (!Array.isArray(conteudo)) return "";
  return conteudo
    .filter((b): b is Bloco => isRecord(b) && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

const quandoDe = (m: Mensagem): number | undefined => (typeof m.timestamp === "number" ? m.timestamp : undefined);

/** Argumentos e texto passam pelo filtro de segredos antes de sair do trace. */
const segura = (valor: unknown): unknown => JSON.parse(redactSecrets(JSON.stringify(valor ?? null)));

/** Passos de uma única mensagem do modelo, na ordem em que aparecem (texto, chamadas e resultado). */
function passosDaMensagem(m: Mensagem): PassoDoTrace[] {
  const quando = quandoDe(m);
  if (m.role === "user") {
    return [{ tipo: "usuario", texto: redactSecrets(textoDe(m.content)), ...(quando ? { quando } : {}) }];
  }
  if (m.role === "toolResult") {
    return [
      {
        tipo: "resultado",
        ferramenta: typeof m.toolName === "string" ? m.toolName : "desconhecida",
        resultado: redactSecrets(textoDe(m.content)),
        erro: m.isError === true,
        ...(quando ? { quando } : {}),
      },
    ];
  }
  if (m.role !== "assistant" || !Array.isArray(m.content)) return [];

  const usage = isRecord(m.usage) ? m.usage : undefined;
  const uso =
    usage && typeof usage.input === "number" && typeof usage.output === "number"
      ? { entrada: usage.input, saida: usage.output }
      : undefined;
  const passos: PassoDoTrace[] = [];
  const texto = m.content
    .filter((b): b is Bloco => isRecord(b) && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
  if (texto)
    passos.push({
      tipo: "agente",
      texto: redactSecrets(texto),
      ...(uso ? { uso } : {}),
      ...(quando ? { quando } : {}),
    });
  for (const bloco of m.content) {
    if (!isRecord(bloco) || bloco.type !== "toolCall") continue;
    passos.push({
      tipo: "chamada",
      ferramenta: typeof bloco.name === "string" ? bloco.name : "desconhecida",
      argumentos: segura(bloco.arguments),
      ...(quando ? { quando } : {}),
    });
  }
  return passos;
}

/** Trace de uma conversa: as entradas em ordem, cada uma com as mensagens que o modelo viu ou produziu. */
export function traceDaConversa(
  entradas: readonly { readonly model?: readonly unknown[]; readonly kind?: string }[],
): PassoDoTrace[] {
  return entradas.flatMap((entrada) =>
    (entrada.model ?? []).filter(isRecord).flatMap((m) => passosDaMensagem(m as Mensagem)),
  );
}
