/** Papel de um perfil no roteamento: PO recebe perguntas de negócio; tech lead, as técnicas. `outro` não recebe. */
export type PapelPerfil = "po" | "tech_lead" | "outro";

/** Perfil do projeto, com nome livre (ex.: "Analista de negócio"). */
export interface Perfil {
  nome: string;
  papel: PapelPerfil;
}

/** O que o roteamento precisa de uma pessoa do projeto. `role` é a forma antiga, mantida por compatibilidade. */
export interface PessoaComPerfis {
  id: string;
  role?: "po" | "tech_lead";
  perfis?: string[];
}

export interface ConfigPerfis<P extends PessoaComPerfis> {
  profiles: Perfil[];
  people: P[];
}

/** Modelos prontos oferecidos ao criar um perfil (fatia 06). O nome é livre depois de criado. */
export const PERFIS_PRONTOS: Perfil[] = [
  { nome: "PO", papel: "po" },
  { nome: "Tech Lead", papel: "tech_lead" },
];

/**
 * Pessoas que recebem perguntas de um papel, na ordem da lista. Uma pessoa entra se algum dos seus perfis tem esse papel,
 * ou pela forma antiga (`role`). Quem não tem perfil desse papel nunca recebe a pergunta.
 */
export function pessoasDoPapel<P extends PessoaComPerfis>(config: ConfigPerfis<P>, papel: "po" | "tech_lead"): P[] {
  return config.people.filter(
    (p) =>
      p.role === papel ||
      (p.perfis ?? []).some((nome) => config.profiles.find((perfil) => perfil.nome === nome)?.papel === papel),
  );
}

/**
 * Erros da atribuição de perfis: perfil repetido e pessoa que aponta para perfil não cadastrado. Vazio se tudo está
 * consistente.
 */
export function validarPerfis<P extends PessoaComPerfis>(config: ConfigPerfis<P>): string[] {
  const erros: string[] = [];
  const vistos = new Set<string>();
  for (const perfil of config.profiles) {
    if (vistos.has(perfil.nome)) erros.push(`perfil "${perfil.nome}" repetido`);
    vistos.add(perfil.nome);
  }
  for (const pessoa of config.people) {
    for (const nome of pessoa.perfis ?? []) {
      if (!vistos.has(nome)) erros.push(`pessoa ${pessoa.id}: perfil "${nome}" não cadastrado`);
    }
  }
  return erros;
}

/**
 * Identificador da pessoa no Teams, usado para o aviso (fatia 08). Prefere `identidades.teams`; a forma antiga
 * (`teamsUserId`) vale quando a nova não existe.
 */
export function identidadeTeams(pessoa: {
  identidades?: { teams?: string };
  teamsUserId?: string;
}): string | undefined {
  return pessoa.identidades?.teams ?? pessoa.teamsUserId;
}

/**
 * A pessoa seguinte à `idAtual` entre as do mesmo papel, na ordem da lista: é para onde a pergunta escalona (fatia 07).
 * `undefined` se `idAtual` é a última, ou não tem esse papel.
 */
export function proximaPessoaDoPapel<P extends PessoaComPerfis>(
  config: ConfigPerfis<P>,
  papel: "po" | "tech_lead",
  idAtual: string,
): P | undefined {
  const pessoas = pessoasDoPapel(config, papel);
  const indice = pessoas.findIndex((p) => p.id === idAtual);
  return indice >= 0 ? pessoas[indice + 1] : undefined;
}

/** Canal por onde a fábrica fala com uma pessoa: comentário no card (perguntas e respostas) ou também o aviso no Teams. */
export type CanalPessoa = "card-comment" | "teams";

/**
 * Canal da pessoa (fatia 08): o escolhido, ou o comentário no card. `teams` é conversa no Teams: a pergunta e a
 * resposta passam por lá.
 */
export function canalDaPessoa(pessoa: {
  id?: string;
  canal?: CanalPessoa;
  identidades?: { teams?: string };
  teamsUserId?: string;
}): CanalPessoa {
  return pessoa.canal ?? "card-comment";
}

/**
 * Aviso legado no Teams: só para quem não escolheu canal e tem identidade no Teams (comportamento anterior à fatia 08).
 * Com canal escolhido, o aviso não existe: `teams` já é a conversa, e `card-comment` não avisa.
 */
export function avisoTeamsDe(pessoa: {
  id?: string;
  canal?: CanalPessoa;
  identidades?: { teams?: string };
  teamsUserId?: string;
}): string | undefined {
  return pessoa.canal === undefined ? identidadeTeams(pessoa) : undefined;
}
