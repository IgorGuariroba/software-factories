# No GitHub, a fábrica escreve com o token de instalação do App

**Estado:** aceita, não implementada. Plano: [fase 3](../plano-evolucao-arquitetura.md#fase-3-entrada-por-reconciliação-e-escrita-pelo-app).

A ADR-0003 faz a fábrica agir com as credenciais do usuário, cujo alcance no GitHub é maior que o de um projeto. Para repositórios no GitHub já há um App instalado, que entrega eventos (ADR-0015). Decidimos que push, PR, comentários e labels no GitHub saem com o token de instalação do App, restrito ao repositório do projeto e às permissões necessárias. Substitui a [ADR-0003](0003-age-com-credenciais-do-usuario.md) para o GitHub; no Jira, no GitLab e no Teams ela continua valendo.

- **Alcance.** O token é pedido só para o repositório do projeto, com escrita em conteúdo, pull requests e issues. Vale uma hora e não é gravado em disco nem na configuração do clone.
- **Guardrail também no remoto.** O App não recebe permissão de merge nem entra nas exceções da proteção de branch. Assim o GitHub recusa merge e push na branch padrão mesmo que o código da fábrica falhe. A fábrica confere a proteção e avisa quando o repositório não a tem.
- **Identidade visível.** PRs e comentários aparecem como o bot do App. O prefixo de automação continua.
- **Escolha explícita, sem volta automática.** Cada projeto diz se escreve pelo App ou pelo usuário. Um projeto configurado para o App sem instalação que cubra o repositório fica incompleto; a fábrica não recua sozinha para as credenciais do usuário.

## Considered Options

- Manter as credenciais do usuário: rejeitado como padrão, porque um erro da fábrica alcança todos os repositórios do usuário.
- Token pessoal de escopo fino por projeto: rejeitado, porque exige criar e renovar à mão um token por repositório.

## Consequências

- O PR deixa de aparecer como aberto pelo usuário.
- A fábrica passa a reconhecer como seus os comentários do bot e, durante a transição, também os antigos do usuário.
- Proteção de branch não existe em todo plano do GitHub para repositório privado. Onde não houver, o guardrail continua sendo só o do código.
- O repositório público das retrôs continua com as credenciais do usuário.
