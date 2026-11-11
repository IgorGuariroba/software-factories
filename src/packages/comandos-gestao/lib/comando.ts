/** Comandos que agem sobre uma Tarefa escolhida pela referência. */
export type ComandoTarefa = "/vetar" | "/pausar" | "/retomar" | "/cancelar" | "/responder";

const COMANDOS_TAREFA: ReadonlySet<string> = new Set<ComandoTarefa>([
  "/vetar",
  "/pausar",
  "/retomar",
  "/cancelar",
  "/responder",
]);

/** O que uma mensagem da gestão quer dizer. */
export type Comando =
  | { tipo: "pausa-daemon"; pausar: boolean }
  | { tipo: "ajuda" }
  | { tipo: "tarefa"; comando: ComandoTarefa; referencia: string; texto: string };

/**
 * Interpreta a mensagem: o comando é a primeira palavra (sem diferenciar caixa e sem o `@bot` do Telegram). `/pausar` e
 * `/retomar` sem referência pausam ou retomam o daemon; os demais exigem a Tarefa; o que não é comando conhecido é ajuda.
 */
export function interpretarComando(texto: string): Comando {
  const [cabeca = "", referencia] = texto.trim().split(/\s+/);
  const comando = cabeca.toLowerCase().replace(/@.*$/, "");
  if ((comando === "/pausar" || comando === "/retomar") && !referencia)
    return { tipo: "pausa-daemon", pausar: comando === "/pausar" };
  if (!COMANDOS_TAREFA.has(comando) || !referencia) return { tipo: "ajuda" };
  return { tipo: "tarefa", comando: comando as ComandoTarefa, referencia, texto: texto.trim() };
}

/** A resposta de `/responder <projeto/chave> <n> <texto>`: o número da pergunta e o texto. `undefined` se não bate. */
export function respostaDaPergunta(texto: string): { n: number; texto: string } | undefined {
  const casa = /^\S+\s+\S+\s+(\d+)\s+([\s\S]+)$/.exec(texto.trim());
  return casa ? { n: Number(casa[1]), texto: casa[2] as string } : undefined;
}

/**
 * Acha a Tarefa pela referência: o id `projeto/chave` é exato; a chave sem projeto não diferencia caixa e não pode ser
 * ambígua. Devolve o id ou o erro para o usuário.
 */
export function resolverTarefa(
  tarefas: readonly { id: string; key: string }[],
  referencia: string,
): { id: string } | { erro: string } {
  if (referencia.includes("/")) {
    const tarefa = tarefas.find((t) => t.id === referencia);
    return tarefa ? { id: tarefa.id } : { erro: `Não achei a Tarefa ${referencia}.` };
  }
  const casam = tarefas.filter((t) => t.key.toUpperCase() === referencia.toUpperCase());
  if (casam.length === 0) return { erro: `Não achei a Tarefa ${referencia}.` };
  if (casam.length > 1)
    return { erro: `Há mais de uma Tarefa ${referencia}; use projeto/chave: ${casam.map((t) => t.id).join(", ")}.` };
  return { id: (casam[0] as { id: string }).id };
}
