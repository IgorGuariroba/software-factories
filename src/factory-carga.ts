import { ProjectConfig } from "./config.js";
import type { FactoryState } from "./durable.js";
import type { FactoryProject, startFactory } from "./factory.js";
import { lerConfiguracao } from "./packages/config-store/index.js";
import { decidirCargaDoSalvo, recriaFonte } from "./packages/configuracao-projeto/index.js";

type FactoryOpts = Parameters<typeof startFactory>[0];

// Carga dos projetos: os do YAML, os salvos pela interface e a remoção dos que saíram. Troca de configuração e registro
// de projeto novo ficam aqui também, sobre o mesmo mapa de projetos carregados.

/** O que a carga dos projetos precisa da fábrica. */
export interface DepsCargaProjetos {
  opts: FactoryOpts;
  projects: Map<string, unknown>;
  bases: Map<string, FactoryProject>;
  criadosPelaInterface: Set<string>;
  montarProjeto(p: FactoryProject): unknown;
  readState(): Promise<FactoryState>;
}

/** Carga e troca dos projetos carregados. */
export function criarCarregadorDeProjetos(deps: DepsCargaProjetos) {
  const { opts, projects, bases, criadosPelaInterface, montarProjeto, readState } = deps;

  /** Troca a configuração de um projeto carregado, mantendo a Fonte e o conhecimento dele. */
  function aplicarConfiguracao(config: ProjectConfig): boolean {
    const base = bases.get(config.name);
    if (!base) return false;
    // Trocar o tipo da Fonte cria a Fonte nova; mudar só os campos mantém a que já existe.
    const trocouTipo = recriaFonte(base.config, config, Boolean(opts.createSource));
    const nova: FactoryProject = trocouTipo
      ? { ...base, config, source: opts.createSource?.(config) ?? base.source }
      : { ...base, config };
    bases.set(config.name, nova);
    projects.set(config.name, montarProjeto(nova));
    return true;
  }

  function registrarProjeto(config: ProjectConfig): void {
    if (!opts.createSource) throw new Error("este daemon não cria a Fonte de projetos da interface");
    criadosPelaInterface.add(config.name);
    const knowledgeDir = opts.knowledgeDirFor?.(config.name);
    const base: FactoryProject = {
      config,
      source: opts.createSource(config),
      ...(knowledgeDir ? { knowledgeDir } : {}),
    };
    bases.set(config.name, base);
    projects.set(config.name, montarProjeto(base));
  }

  /** Carrega, no início, o que o estado guarda: a configuração salva dos projetos do YAML, a remoção dos que saíram e os criados pela interface. */
  async function carregarSalvos(): Promise<void> {
    for (const p of opts.projects) {
      const guardada = lerConfiguracao((await readState()).projetos?.[p.config.name]);
      if (guardada) aplicarConfiguracao(guardada);
    }
    for (const nome of Object.keys((await readState()).projetosRemovidos ?? {})) {
      projects.delete(nome);
      bases.delete(nome);
      criadosPelaInterface.delete(nome);
    }

    // Projetos criados pela UI voltam com o estado. Um nome que o YAML já usa não é sobrescrito (o YAML manda).
    for (const [nome, salvo] of Object.entries((await readState()).projetosGitHub ?? {})) {
      // Lê a configuração salva só quando é preciso: o nome que o YAML já usa não chega a ser lido. A decisão está no pacote.
      const lido = projects.has(nome) ? undefined : ProjectConfig.safeParse(JSON.parse(salvo));
      const decisao = decidirCargaDoSalvo({
        nomeNoYaml: projects.has(nome),
        salvoValido: lido?.success ?? false,
        podeCriarFonte: Boolean(opts.createSource),
      });
      if (decisao === "ja-no-yaml") continue;
      if (decisao === "invalido") {
        console.error(`[fábrica] projeto ${nome} salvo pela interface está inválido e não foi carregado`);
        continue;
      }
      if (decisao === "sem-fonte") {
        console.error(`[fábrica] projeto ${nome} salvo pela interface não carregado: este daemon não cria Fontes`);
        continue;
      }
      // A configuração guardada é a que vale: a edição pela interface grava em `projetos`, depois da criação.
      const guardada = lerConfiguracao((await readState()).projetos?.[nome]) ?? (lido?.success ? lido.data : undefined);
      if (guardada) registrarProjeto(guardada);
    }
  }

  return { aplicarConfiguracao, registrarProjeto, carregarSalvos };
}
