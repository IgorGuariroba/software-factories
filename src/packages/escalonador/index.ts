// Entry point público do escalonador: serializa buscas e sincronizações, reage a mudanças de estado, registra mudanças de
// status e escolhe a próxima Tarefa a ativar. A execução dessas ações é dada pelas portas.
import { criarFila } from "./lib/fila.js";
import type { EventoEscalonador, PortasEscalonador, TarefaEscalonador } from "./lib/portas.js";
import { criarReacao } from "./lib/reacao.js";

export type { EstadoEscalonador, EventoEscalonador, PortasEscalonador, TarefaEscalonador } from "./lib/portas.js";

export interface Escalonador {
  /** Busca na Fonte. Roda depois de qualquer busca ou sincronização já pedida. */
  pedirBusca(): Promise<void>;
  /** Sincronização (ex.: reconciliar repositórios), na mesma fila das buscas, sem contar como busca pendente. */
  sincronizar(tarefa: () => Promise<void>): Promise<void>;
  /** Buscas pedidas e ainda não concluídas (o timer pula o tick enquanto houver alguma). */
  buscasPendentes(): number;
  /** Pede uma reação: registra mudanças de status e tenta ativar a próxima Tarefa. */
  pedirReacao(): void;
  /** Encerra: cancela o despertar e impede novas reações. As que já rodam terminam antes de `ociosa` resolver. */
  parar(): void;
  /** Espera as buscas, sincronizações e reações em andamento terminarem. */
  ociosa(): Promise<void>;
}

const ESTADOS_QUE_ESPERAM_ATIVACAO = ["enfileirada", "aguardando-entrega"];
const MOTIVOS_VISIVEIS = ["bloqueada", "enfileirada", "vetada", "aguardando-entrega"];

export async function criarEscalonador(portas: PortasEscalonador): Promise<Escalonador> {
  const fila = criarFila();
  let encerrando = false;
  let desarmar: (() => void) | undefined;
  // O estado inicial é a referência: o que já existia ao subir não vira evento.
  let conhecidos = new Map((await portas.estado()).tasks.map((t) => [t.id, t.status]));
  const ultimoRegistrado = new Map<string, string>();
  const projetoSemConfiguracaoAvisado = new Set<string>();

  async function registrarMudancas(): Promise<void> {
    const estado = await portas.estado();
    const mudaram = estado.tasks.filter((t) => conhecidos.get(t.id) !== t.status);
    conhecidos = new Map(estado.tasks.map((t) => [t.id, t.status]));
    for (const t of mudaram) {
      // Acompanhamento do PR/MR: cada consulta passa por "ativa"; só registra quando o estado observado muda.
      const assinatura = `${t.status}|${t.reason ?? ""}`;
      const ultimo = ultimoRegistrado.get(t.id);
      if (t.status === "ativa" && ultimo?.startsWith("aguardando-entrega|")) continue;
      if (ultimo === assinatura) continue;
      ultimoRegistrado.set(t.id, assinatura);
      await portas.registrarEvento(eventoDeTarefa(t));
    }
  }

  function eventoDeTarefa(t: TarefaEscalonador): EventoEscalonador {
    const comMotivo = t.reason && MOTIVOS_VISIVEIS.includes(t.status) ? { reason: t.reason } : {};
    return { type: "task", project: t.project, id: t.id, key: t.key, status: t.status, ...comMotivo };
  }

  async function agendar(): Promise<void> {
    const estado = await portas.estado();
    if (estado.daemonPaused || estado.tasks.some((t) => t.status === "ativa")) return;
    const agora = portas.agora();
    let proxima: TarefaEscalonador | undefined;
    let despertarEm = Number.POSITIVE_INFINITY;
    for (const t of estado.tasks) {
      if (!ESTADOS_QUE_ESPERAM_ATIVACAO.includes(t.status) || t.pauseRequested) continue;
      // Repositório desativado, projeto pausado ou incompleto: a Tarefa espera (ADR-0015, ticket 09, ADR-0022).
      if (portas.repoDesativado(estado, t.project)) continue;
      if (portas.projetoPausado(estado, t.project)) continue;
      if (portas.pendenciasBloqueantes(t.project, estado).length > 0) continue;
      if (!portas.projetoConfigurado(t.project)) {
        if (!projetoSemConfiguracaoAvisado.has(t.id)) {
          projetoSemConfiguracaoAvisado.add(t.id);
          await portas.registrarEvento({
            type: "error",
            project: t.project,
            target: t.key,
            message: `falha ao agendar: Projeto ${t.project} não está configurado`,
          });
        }
        continue;
      }
      const at = Math.max(t.notBefore ?? 0, portas.proximaAtividade(t.project, agora));
      if (at <= agora) proxima ??= t;
      else if (at < despertarEm) despertarEm = at;
    }
    if (!proxima) {
      if (Number.isFinite(despertarEm) && !encerrando) {
        desarmar?.();
        desarmar = portas.armTimer(() => reacao.pedir(), Math.max(0, despertarEm - agora));
      }
      return;
    }
    await portas.ativar(proxima.id);
  }

  const reacao = criarReacao(
    async () => {
      try {
        await registrarMudancas();
        await agendar();
      } catch (err) {
        if (!encerrando) portas.registrarErro("[fábrica] erro no agendador:", err);
      }
    },
    () => encerrando,
  );

  return {
    pedirBusca: () => fila.executar(() => portas.buscar(), true),
    sincronizar: (tarefa) => fila.executar(tarefa, false),
    buscasPendentes: () => fila.buscasPendentes(),
    pedirReacao: () => reacao.pedir(),
    parar() {
      encerrando = true;
      desarmar?.();
    },
    async ociosa() {
      await fila.ociosa();
      await reacao.ociosa();
    },
  };
}
