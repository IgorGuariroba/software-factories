// Apresentação pura do painel do GitHub App: sem DOM, para testar em Node (test/web-github-app.test.ts).

/**
 * Linhas do painel, cada uma com o texto e um tom: "ok", "atencao" ou "neutro".
 * @param {{
 *   receptor: { ligado: boolean, porta: number | null, ultimaEntregaEm: string | null },
 *   app: { configurado: boolean, erro?: string, app?: { id: number, slug?: string, nome: string }, instalacoes: { conta: string }[] },
 *   repositorios: { projeto: string, repo: string, status: "ativo" | "desativado", coberto: boolean | null }[]
 * }} painel
 */
export function linhasGithubApp(painel) {
  const { receptor, app } = painel;
  const linhas = [
    {
      rotulo: "Receptor do webhook",
      valor: receptor.ligado ? `ligado na porta ${receptor.porta}` : "desligado",
      tom: receptor.ligado ? "ok" : "atencao",
    },
    {
      rotulo: "Última entrega aplicada",
      valor: receptor.ultimaEntregaEm ? formatarInstante(receptor.ultimaEntregaEm) : "nenhuma ainda",
      tom: "neutro",
    },
  ];

  if (!app.configurado) {
    linhas.push({
      rotulo: "GitHub App",
      valor: "não configurado: defina FACTORY_GITHUB_APP_ID e FACTORY_GITHUB_APP_PRIVATE_KEY_PATH",
      tom: "atencao",
    });
  } else if (app.erro) {
    linhas.push({ rotulo: "GitHub App", valor: `consulta falhou: ${app.erro}`, tom: "atencao" });
  } else {
    linhas.push({ rotulo: "GitHub App", valor: `${app.app.nome} (ID ${app.app.id})`, tom: "ok" });
    const instalacoes = app.instalacoes;
    linhas.push(
      instalacoes.length === 0
        ? { rotulo: "Instalações", valor: "nenhuma: instale o App no repositório", tom: "atencao" }
        : {
            rotulo: "Instalações",
            valor: `${instalacoes.length} ${instalacoes.length === 1 ? "instalação" : "instalações"}: ${instalacoes.map((i) => i.conta).join(", ")}`,
            tom: "ok",
          },
    );
  }

  for (const repositorio of painel.repositorios) {
    if (repositorio.status === "desativado") {
      linhas.push({ rotulo: repositorio.repo, valor: "desplugado", tom: "neutro" });
    } else if (repositorio.coberto === true) {
      linhas.push({ rotulo: repositorio.repo, valor: "coberto pelo App", tom: "ok" });
    } else if (repositorio.coberto === false) {
      linhas.push({ rotulo: repositorio.repo, valor: "fora do App: instale o App neste repositório", tom: "atencao" });
    } else {
      linhas.push({ rotulo: repositorio.repo, valor: "cobertura desconhecida", tom: "neutro" });
    }
  }
  return linhas;
}

/**
 * Aviso do que deixa de chegar por webhook. A busca periódica continua recuperando as mudanças, por isso o texto diz
 * isso. Devolve undefined quando todo repositório plugado está coberto ou quando não há como saber.
 * @param {{ repositorios: { status: string, coberto: boolean | null }[] }} painel
 */
export function alertaGithubApp(painel) {
  const semCobertura = painel.repositorios.filter((r) => r.status === "ativo" && r.coberto === false).length;
  if (semCobertura === 0) return undefined;
  const plural = semCobertura > 1;
  return `${semCobertura} ${plural ? "repositórios plugados estão" : "repositório plugado está"} fora do App: as mudanças ${plural ? "deles" : "dele"} chegam só pela busca periódica, não em tempo real.`;
}

/**
 * Fluxo de ligação do App, como etapas em ordem. Cada etapa é "feito", "pendente" ou "desconhecido" (quando a consulta
 * ao App não deu certo, a etapa que depende dela não é afirmada).
 * @param {Parameters<typeof linhasGithubApp>[0]} painel
 */
export function etapasGithubApp(painel) {
  const { receptor, app, repositorios } = painel;
  const instalado = app.configurado && !app.erro ? app.instalacoes.length > 0 : undefined;
  const ativos = repositorios.filter((r) => r.status === "ativo");
  const recebeu = receptor.ultimaEntregaEm !== null;
  const estado = (feito) => (feito === undefined ? "desconhecido" : feito ? "feito" : "pendente");
  // Cobertura: feita se algum ativo está coberto; desconhecida se nenhum foi confirmado mas a consulta não disse
  // (todos null); pendente caso contrário.
  const cobertura = (() => {
    if (ativos.length === 0) return "pendente";
    if (ativos.some((r) => r.coberto === true)) return "feito";
    if (ativos.every((r) => r.coberto === null)) return "desconhecido";
    return "pendente";
  })();
  const slug = app.app?.slug;
  const instalar = estado(instalado);
  return [
    {
      titulo: "Instalar o App",
      descricao: "O GitHub App é instalado na sua conta, com acesso só aos repositórios escolhidos.",
      estado: instalar,
      // Ação só quando falta instalar e o slug do App é conhecido: leva direto à página de instalação.
      acao:
        instalar === "pendente" && slug
          ? { rotulo: "Instalar o App", url: `https://github.com/apps/${encodeURIComponent(slug)}/installations/new` }
          : undefined,
    },
    {
      titulo: "Receptor recebe os eventos",
      descricao: "Um túnel leva os eventos do GitHub até o receptor local, que confere a assinatura.",
      estado: receptor.ligado ? "feito" : "pendente",
    },
    {
      titulo: "Repositório plugado e coberto",
      descricao: "O repositório da fábrica está ativo e o App cobre esse repositório.",
      estado: cobertura,
    },
    {
      titulo: "Entregas chegando",
      descricao: "A fábrica já aplicou ao menos um evento do GitHub às Tarefas.",
      estado: recebeu ? "feito" : "pendente",
    },
  ];
}

/** Quantas etapas do fluxo estão feitas, para o contador ("2 de 4 concluídas"). */
export function progressoGithubApp(etapas) {
  const feitas = etapas.filter((e) => e.estado === "feito").length;
  return `${feitas} de ${etapas.length} ${etapas.length === 1 ? "etapa concluída" : "etapas concluídas"}`;
}

/** Data e hora legíveis em português, a partir do ISO 8601 que a API devolve. */
function formatarInstante(iso) {
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? iso : data.toLocaleString("pt-BR");
}
