/** Rótulo legível de cada etapa do trace; a retrô leva a etapa que ela revisa. */
const ROTULOS = { spec: "SPEC", triagem: "Triagem", review: "Review", implementacao: "Implementação" };

export function rotuloEtapa(etapa) {
  if (ROTULOS[etapa]) return ROTULOS[etapa];
  if (etapa.startsWith("retro:")) return `Retrô ${etapa.slice("retro:".length)}`;
  return etapa;
}

/** Corta um texto longo no limite, com reticências, sem mudar um texto curto. */
export function trechoDoTexto(texto, limite) {
  return texto.length > limite ? `${texto.slice(0, limite)}…` : texto;
}

/** Linha curta de um passo do trace, para a leitura rápida antes de abrir o detalhe. */
export function resumoDoPasso(passo) {
  switch (passo.tipo) {
    case "usuario":
      return "Pedido da fábrica";
    case "agente":
      return trechoDoTexto(passo.texto, 160);
    case "chamada":
      return `Chamou ${passo.ferramenta}`;
    case "resultado":
      return passo.erro ? `Erro em ${passo.ferramenta}` : `Resultado de ${passo.ferramenta}`;
    default:
      return passo.tipo;
  }
}

/** Duração em texto curto; `null` quando o trace não tem carimbos de tempo. */
function formatarDuracao(ms) {
  if (ms === null || ms === undefined) return null;
  const segundos = Math.round(ms / 1000);
  return segundos < 60 ? `${segundos} s` : `${Math.floor(segundos / 60)} min ${segundos % 60} s`;
}

const plural = (n, singular, plural_) => `${n} ${n === 1 ? singular : plural_}`;

/** Uma linha com os agregados de uma execução; sem métricas, diz que estão indisponíveis (não mostra zero). */
export function resumoDasMetricas(metricas) {
  if (!metricas) return "Métricas indisponíveis";
  const partes = [
    `${metricas.tokensEntrada} tokens de entrada`,
    `${metricas.tokensSaida} de saída`,
    plural(metricas.chamadas, "chamada", "chamadas"),
    plural(metricas.erros, "erro", "erros"),
  ];
  const duracao = formatarDuracao(metricas.duracaoMs);
  if (duracao) partes.push(duracao);
  return partes.join(" · ");
}

/** Soma dos agregados das etapas de uma tarefa; etapas sem métricas não entram. */
export function totalDaTarefa(etapas) {
  const total = { tokensEntrada: 0, tokensSaida: 0, chamadas: 0, erros: 0 };
  for (const { metricas } of etapas) {
    if (!metricas) continue;
    total.tokensEntrada += metricas.tokensEntrada;
    total.tokensSaida += metricas.tokensSaida;
    total.chamadas += metricas.chamadas;
    total.erros += metricas.erros;
  }
  return total;
}

const TEXTO_DO_DETALHE = 4000;

/** Detalhe recolhível de um passo: argumentos e resultados completos, com o corte para textos enormes. */
function detalheDoPasso(passo, el) {
  if (passo.tipo === "chamada") {
    return el("pre", {
      className: "texto",
      text: trechoDoTexto(JSON.stringify(passo.argumentos, null, 2), TEXTO_DO_DETALHE),
    });
  }
  if (passo.tipo === "resultado") {
    return el("pre", { className: "texto", text: trechoDoTexto(passo.resultado, TEXTO_DO_DETALHE) });
  }
  return el("p", { text: trechoDoTexto(passo.texto ?? "", TEXTO_DO_DETALHE) });
}

/**
 * Painel do trace: uma aba por etapa e, dentro dela, a conversa em ordem. Cada chamada e resultado de ferramenta é um
 * bloco recolhível. `etapaAtiva` escolhe a aba; `aoEscolher` recebe o nome da etapa clicada.
 */
export function renderTrace(container, etapas, etapaAtiva, el, { aoEscolher, aoEnviar, aoEsquecer }) {
  if (etapas.length === 0) {
    container.replaceChildren(el("p", { className: "vazio", text: "Nenhuma execução de etapa ainda." }));
    return;
  }
  const ativa = etapas.find((e) => e.etapa === etapaAtiva) ?? etapas[0];
  const seletor = el(
    "div",
    { className: "abas", attrs: { role: "tablist", "aria-label": "Etapas do trace" } },
    ...etapas.map((e) =>
      el("button", {
        text: rotuloEtapa(e.etapa),
        attrs: {
          type: "button",
          role: "tab",
          "aria-selected": String(e.etapa === ativa.etapa),
          "data-etapa-trace": e.etapa,
        },
        onClick: () => aoEscolher(e.etapa),
      }),
    ),
  );
  const passos = ativa.passos.map((passo) => {
    const resumo = resumoDoPasso(passo);
    if (passo.tipo === "chamada" || passo.tipo === "resultado") {
      return el(
        "details",
        { className: `passo passo-${passo.tipo}${passo.erro ? " passo-erro" : ""}` },
        el("summary", { text: resumo }),
        detalheDoPasso(passo, el),
      );
    }
    return el(
      "div",
      { className: `passo passo-${passo.tipo}` },
      el("strong", { text: resumo }),
      detalheDoPasso(passo, el),
    );
  });
  const campo = el("textarea", {
    className: "mensagem-etapa",
    attrs: { "aria-label": "Mensagem para o agente desta etapa", rows: "3" },
  });
  const enviar = el("button", {
    text: "Enviar ao agente",
    attrs: { type: "button" },
    onClick: () => {
      const texto = campo.value.trim();
      if (texto) aoEnviar(ativa.etapa, texto);
    },
  });
  const esquecer = el("button", {
    text: "Esquecer memória desta etapa",
    attrs: { type: "button", title: "A próxima execução começa com uma conversa nova; o histórico fica guardado." },
    onClick: () => aoEsquecer?.(ativa.etapa),
  });
  container.replaceChildren(
    el("p", {
      className: "metricas-trace",
      text: `Total da tarefa: ${resumoDasMetricas({ ...totalDaTarefa(etapas), duracaoMs: null })}`,
    }),
    el("p", { className: "metricas-trace", text: resumoDasMetricas(ativa.metricas) }),
    seletor,
    ativa.passos.length === 0
      ? el("p", { className: "vazio", text: "Esta etapa ainda não tem passos." })
      : el("div", { className: "conversa-trace" }, ...passos),
    el("div", { className: "mensagem-trace" }, campo, enviar),
    ativa.etapa === "spec" ? esquecer : el("span", {}),
  );
}
