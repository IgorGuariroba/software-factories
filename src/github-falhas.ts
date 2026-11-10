/**
 * Mensagens das falhas ao falar com o GitHub (ADR-0015, Fase 7). Função pura: a chamada HTTP só repassa o status e os
 * cabeçalhos. A mensagem nunca traz token, chave nem o corpo da resposta.
 */

export interface CabecalhosLimite {
  /** `x-ratelimit-remaining`: quantas requisições ainda cabem na janela. */
  remaining?: string | null;
  /** `x-ratelimit-reset`: instante em que a janela libera, em segundos desde a época. */
  reset?: string | null;
  /** `retry-after`: segundos até poder tentar de novo (limite secundário). */
  retryAfter?: string | null;
}

/** Mensagem de uma resposta de erro do GitHub, em português, sem dados sensíveis. */
export function falhaDeResposta(opts: {
  status: number;
  caminho: string;
  cabecalhos?: CabecalhosLimite;
  agora: number;
}): string {
  const { status, caminho, cabecalhos = {}, agora } = opts;
  const limite = status === 429 || (status === 403 && (cabecalhos.remaining === "0" || cabecalhos.retryAfter != null));
  if (limite) {
    const liberaEm = instanteDeLiberacao(cabecalhos, agora);
    return `limite de requisições da API do GitHub atingido${liberaEm ? `; libera às ${liberaEm}` : ""}`;
  }
  if (status === 403) {
    return `o App não tem permissão para ${caminho}: confira as permissões de leitura do App (Issues e Metadata)`;
  }
  if (status === 404 && /\/access_tokens$/.test(caminho)) {
    return "a instalação do App foi removida ou suspensa no GitHub";
  }
  return `GitHub respondeu ${status} em ${caminho}`;
}

/** Falha de rede ou tempo esgotado, sem detalhes do erro original (que pode trazer a URL). */
export function falhaDeRede(err: unknown): string {
  const nome = err instanceof Error ? err.name : "";
  if (nome === "TimeoutError" || nome === "AbortError") return "o GitHub não respondeu a tempo";
  return "falha de rede ao falar com o GitHub";
}

function instanteDeLiberacao(cabecalhos: CabecalhosLimite, agora: number): string | undefined {
  let ms: number | undefined;
  if (cabecalhos.reset && Number.isFinite(Number(cabecalhos.reset))) ms = Number(cabecalhos.reset) * 1000;
  else if (cabecalhos.retryAfter && Number.isFinite(Number(cabecalhos.retryAfter))) {
    ms = agora + Number(cabecalhos.retryAfter) * 1000;
  }
  if (ms === undefined) return undefined;
  return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
