// Identidade e canal de cada pessoa do projeto: o identificador no Teams, o canal escolhido (comentário no card ou Teams) e
// os avisos que dependem deles. O roteamento por papel fica em perfis.ts.

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

/**
 * Identidade no Teams pela qual a pessoa recebe pelo canal Teams, se o canal está disponível: a pessoa existe, tem
 * identidade no Teams e a conversa do bot está configurada. Sem qualquer um desses, `undefined`: a pergunta vai pelo
 * card.
 */
export function identidadeDoCanalTeams(
  pessoa: { identidades?: { teams?: string }; teamsUserId?: string } | undefined,
  conversaConfigurada: boolean,
): string | undefined {
  if (!pessoa || !conversaConfigurada) return undefined;
  return identidadeTeams(pessoa);
}
