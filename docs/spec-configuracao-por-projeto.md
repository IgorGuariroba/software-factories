# SPEC: configuração por projeto (Fontes, Canais, Perfis e Pessoas) via interface, com integrações plugáveis

## Problem Statement

Hoje a configuração de cada projeto (de onde chegam as demandas, por onde a fábrica conversa com as pessoas, quem é o PO e o tech lead) fica em YAML fora do repositório. Para mudar qualquer coisa é preciso editar arquivo e reiniciar o daemon. Além disso, a fonte de demandas e o canal de conversa estão escritos no código para Jira, GitHub e Teams: adicionar GitLab Issues, ou outro canal, exige mexer no núcleo da fábrica. O usuário quer escolher, na interface, de onde vêm as demandas (Jira, GitHub Issues, GitLab Issues), por qual canal a fábrica conversa com cada pessoa (Teams, comentário no card) e quem ocupa cada perfil do projeto (PO, tech lead, ou perfis próprios), sem editar arquivos. O código também precisa estar pronto para receber novas integrações sem reescrever o núcleo.

## Solution

Cada projeto passa a ser configurado pela interface web (e por qualquer outra interface futura, pela mesma API). A configuração (Fonte, Canais por pessoa, Perfis, Pessoas do projeto, repositórios locais, provedores permitidos) é guardada no estado durável. O YAML atual serve de semente na primeira execução: projetos novos que aparecem no YAML são criados na base, e depois disso a interface manda. Credenciais são gravadas num cofre cifrado em disco (AES-256-GCM, ADR-0018); a configuração guarda só o nome da credencial, e a interface nunca exibe o valor depois de salvo. As integrações (tipos de Fonte, tipos de Canal) são adaptadores registrados no código: cada um declara o próprio schema, e a interface gera o formulário a partir dele. Um tipo novo de integração é um adaptador novo mais um registro, sem tela específica. Nesta entrega entram: Fontes Jira, GitHub Issues e GitLab Issues; Canais comentário no card e Teams; Interface de gestão web local e Telegram (global ao usuário, com nível de conteúdo por projeto).

## User Stories

1. Como usuário, quero criar um projeto escolhendo a Fonte de demandas (Jira, GitHub Issues ou GitLab Issues), para que a fábrica passe a buscar demandas dela sem editar arquivos.
2. Como usuário, quero que o formulário da Fonte mostre só os campos que aquela integração exige, para que eu não preencha nada desnecessário.
3. Como usuário, quero informar a URL do servidor GitLab (gitlab.com ou self-hosted) no projeto, para usar GitLab Issues corporativo.
4. Como usuário, quero que a Fonte GitLab Issues use labels `fabrica:<status>` e issue fechada como `fechada`, igual à Fonte GitHub, para ter o mesmo comportamento nas duas.
5. Como usuário, quero escolher a forma de conversa com cada pessoa do projeto (comentário no card ou Teams), para que o PO e o tech lead recebam perguntas pelo meio que usam.
6. Como usuário, quero cadastrar perfis do projeto com nome livre (ex.: "Analista de negócio", "Arquiteto"), para representar a organização real do time.
7. Como usuário, quero partir de modelos prontos de PO e tech lead ao criar perfis, para não começar do zero.
8. Como usuário, quero cadastrar pessoas do projeto com um identificador por integração (accountId no Jira, login no GitHub, id no GitLab, id no Teams), para que a fábrica reconheça a mesma pessoa em cada sistema.
9. Como usuário, quero atribuir uma pessoa a um ou mais perfis, para cobrir uma pessoa que acumula funções.
10. Como usuário, quero atribuir vários perfis a uma mesma pessoa, e vários pessoas a um mesmo perfil, para cobrir POs em revezamento.
11. Como usuário, quero definir a ordem das pessoas dentro de um perfil, para que a pergunta vá à primeira disponível e o escalonamento vá à seguinte.
12. Como usuário, quero que perguntas de negócio cheguem ao perfil PO e perguntas técnicas cheguem ao usuário e depois ao perfil tech lead, para que o roteamento siga a regra da fábrica.
13. Como usuário, quero que um perfil não conceda autoridade (veto e aprovação continuam comigo), para que a fábrica nunca aceite decisão de terceiros sozinha.
14. Como usuário, quero configurar o Telegram uma única vez (bot e chat) para todos os projetos, para não repetir o mesmo dado.
15. Como usuário, quero definir o nível de conteúdo que o Telegram recebe em cada projeto, para endurecer um projeto sensível sem afetar os outros.
16. Como usuário, quero gravar uma credencial (token do Jira, do GitLab, do Teams) pela interface, para não precisar mexer em arquivos de credencial à mão.
17. Como usuário, quero que a interface nunca mostre o valor de uma credencial depois de salva, só o nome e a data, para não vazar segredos pela tela.
18. Como usuário, quero que o formulário valide a credencial e a conexão com a Fonte antes de salvar, para não deixar um projeto quebrado.
19. Como usuário, quero editar repositórios locais pela interface (caminho e comando de teste), com validação de que o caminho existe e o comando é aceito, para que essa configuração também não dependa do YAML.
20. Como usuário, quero ver a configuração atual de cada projeto, inclusive os projetos que já existiam no YAML, para entender o que a fábrica está usando.
21. Como usuário, quero que a primeira execução crie no estado durável os projetos do YAML que ainda não existem nele, para não perder a configuração atual.
22. Como usuário, quero que, depois da semente, uma mudança no YAML não sobrescreva o que eu editei na interface, para que minhas alterações não sejam desfeitas por acidente.
23. Como usuário, quero um aviso claro quando a configuração de um projeto estiver incompleta (ex.: sem perfil PO), para saber o que falta antes de a fábrica agir.
24. Como usuário, quero que um projeto criado ou alterado comece em dry-run quando a configuração for nova, para observar as escritas antes de a fábrica agir de verdade.
25. Como usuário, quero desligar o dry-run pela interface, para ativar a fábrica quando estiver satisfeito.
26. Como usuário, quero que a troca da Fonte de um projeto não apague as tarefas já existentes, para não perder o histórico.
27. Como usuário, quero ver na interface quais tipos de Fonte e Canal estão disponíveis nesta versão, para saber o que posso escolher.
28. Como desenvolvedor, quero adicionar um tipo novo de Fonte ou Canal com um adaptador e um registro, sem alterar a interface nem o núcleo, para estender a fábrica com pouco custo.
29. Como desenvolvedor, quero que cada adaptador declare o schema da própria configuração, para que a interface gere o formulário sem código específico por integração.
30. Como desenvolvedor, quero que a API da configuração seja a única porta de escrita, para que qualquer interface (web ou outra) use as mesmas validações.
31. Como desenvolvedor, quero que o armazenamento de configuração e o de segredos sejam portas com implementação trocável, para testar sem banco real nem cofre real.
32. Como desenvolvedor, quero que os pacotes novos sigam o README de pacotes e passem em `npm run lint:boundaries`, para não criar dependências circulares.
33. Como desenvolvedor, quero que Jira e GitHub migrem para as novas portas sem mudança de comportamento, para que a entrega não quebre projetos em produção.
34. Como desenvolvedor, quero que chaves antigas do YAML continuem válidas, para não exigir migração manual.
35. Como usuário, quero que a fábrica registre no histórico quando a configuração de um projeto mudou e quem mudou, para auditar alterações.
36. Como usuário, quero que o Telegram continue sendo só interface de gestão, sem falar com as pessoas do projeto, para que o canal da equipe não passe pelo meu celular por acidente.

## Implementation Decisions

- **Módulos novos em `src/packages/`**, cada um com `index.ts` como entry point, seguindo o README de pacotes:
  - `config-store`: porta `ConfigStore` (ler e gravar configuração por projeto, Telegram global, e histórico de alterações) e a implementação sobre o estado durável. Guarda só referências a credenciais.
  - `secret-store`: porta `SecretStore` (gravar, verificar existência, listar nomes e datas; nunca ler valor para a interface), com implementação sobre cofre cifrado em disco (ADR-0018).
  - `demand-sources`: registro de tipos de Fonte. Cada tipo implementa a porta `DemandSource` já existente e declara seu schema de configuração. Tipos desta entrega: Jira, GitHub Issues, GitLab Issues.
  - `channels`: registro de tipos de Canal. Cada tipo implementa a porta `Channel` já existente e declara seu schema. Tipos desta entrega: comentário no card, Teams.
  - `profiles`: modelo de Perfil e de Pessoa do projeto (identificadores por integração, ordem dentro do perfil, atribuição N:N), com modelos prontos de PO e tech lead e a regra de roteamento de perguntas e escalonamento.
- **Interface de configuração**: a interface web consome a API HTTP; não contém regra de negócio. Formulários gerados a partir dos schemas dos adaptadores.
- **Semente pelo YAML**: na primeira execução, cada projeto do YAML que não existe no `ConfigStore` é criado nele. Depois disso o YAML não sobrescreve projetos existentes. Isso substitui a regra de prioridade da ADR-0016 e precisa de ADR nova.
- **Limitação da ADR-0016 removida**: a configuração avançada (repositórios, caminho local, comando de teste) passa a ser editável pela interface, com validação de caminho e de comando.
- **Dry-run**: projetos com configuração nova nascem em dry-run; o usuário desliga pela interface.
- **Telegram**: configuração global (bot e chat) no `ConfigStore`; `telegram.content` por projeto. Continua Interface de gestão, fora do registro de Canais.
- **Credenciais**: `SecretStore` sobre cofre cifrado em disco (ADR-0018). A configuração guarda nome da credencial. A interface valida a credencial e a conexão antes de salvar, sem exibir o valor.
- **Perfis não concedem autoridade**: roteiam perguntas e escalonamento. Veto e aprovação permanecem com o usuário.
- **Pessoas**: identificador por integração dentro da própria pessoa do projeto. Fonte e Canal consultam só o identificador que lhes cabe.
- **Fonte por projeto**: uma única. Canal por pessoa do projeto, escolhido na configuração da pessoa.
- **Padrão de labels GitLab**: idêntico ao da Fonte GitHub (`fabrica:<status>`, issue fechada como `fechada`), com URL do servidor configurável.
- **Migração**: Jira e GitHub passam para as portas novas sem mudança de comportamento. Código em `src/*.ts` migra depois, pacote a pacote, em tarefas separadas.
- **Schema e histórico**: tabela de configuração por projeto, tabela de Pessoas e Perfis com vínculo N:N e ordem, e tabela de histórico de alterações (quem, quando, o quê). Sem migração de tarefas existentes.
- **Documentação a produzir junto**: ADR que substitui a prioridade do YAML e a limitação da ADR-0016; ADRs de ConfigStore/SecretStore e de registro de integrações; atualização do `GLOSSARY.md` (já feita nesta sessão).

## Testing Decisions

- Testes de comportamento externo pela API de configuração (criar, editar, validar, semear e recusar) com fakes para `ConfigStore` e `SecretStore`. Não testar implementação interna.
- Testes de cada adaptador de Fonte e de Canal pelo contrato das portas já existentes (`DemandSource`, `Channel`), com fakes de cliente HTTP ou MCP, seguindo o padrão de `github-demand-source` e `jira-demand-source`.
- Testes de roteamento de perguntas: perfil com várias pessoas, pessoa com vários perfis, ordem, escalonamento, e pessoa sem identificador no canal.
- Testes de semente: projeto do YAML criado na primeira execução; mudança posterior no YAML não sobrescreve.
- Testes de validação de credencial e de caminho de repositório, sem segredo real.
- Teste de fronteira: `npm run lint:boundaries` nos pacotes novos.
- Testes contra serviços reais (Jira, GitLab, Teams) são opt-in, conforme CONTRIBUTING.md.
- Prior art: testes atuais de `github-demand-source`, `channel.ts` (`createCardCommentChannel`), `projetos-github` e `config.ts`.

## Out of Scope

- Ferramentas de comunicação além de Teams e comentário no card (Slack, por exemplo).
- Várias Fontes simultâneas por projeto.
- Carregamento dinâmico de plugins de terceiros.
- Remoção de projeto pela interface.
- Migração do código existente em `src/*.ts` para `src/packages/` (tarefas separadas, pacote a pacote).
- Interfaces além da web local e do Telegram.
- Edição de perfis e pessoas por integrações externas (ex.: sincronização automática com o diretório do Jira).

## Further Notes

- Decisões que alteram ADRs existentes: ADR-0010 (config fora do repositório continua, mas o YAML deixa de ser a fonte principal) e ADR-0016 (prioridade do YAML e limitação de configuração avançada). Ambas exigem ADR nova.
- Tarefas sugeridas, em ordem: (1) pacote `secret-store` e `config-store` com semente do YAML; (2) pacote `profiles`; (3) registro de Fontes com Jira e GitHub migrados; (4) GitLab Issues; (5) registro de Canais com comentário no card e Teams; (6) formulários da interface; (7) migração de `src/*.ts` pacote a pacote.
- Riscos: edição pela interface de configuração que o daemon já lê no startup precisa de recarregamento seguro; dupla fonte de verdade entre YAML e estado durável precisa de regra clara (ver seção de decisões).
