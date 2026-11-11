# Plano: evolução da arquitetura (ADR-0023 a ADR-0032)

Plano para implementar as decisões aceitas na revisão de arquitetura de 2026-11-11. Nada aqui está implementado. Cada fase cita as ADRs que realiza e termina num critério de "pronto" que se pode conferir.

## Origem

A revisão de 2026-11-11 comparou a arquitetura proposta (decisões D01 a D09) com o código atual e manteve a direção dela: o modelo propõe, o código decide, a intenção é gravada antes de cada efeito, e o que executa é isolado. As mudanças decididas estão nas ADR-0023 a 0032. Os pontos principais são:

1. Execução do modelo dentro de uma jaula com raiz mínima (ADR-0023).
2. Sessão na API local (ADR-0023).
3. Ferramentas MCP com efeito declarado (ADR-0025).
4. Classe e cota saem do desenho atual (ADR-0028).

A revisão não adota a maquinaria de sistema distribuído da proposta (executores em processos separados, IPC, leases, inbox e outbox): a fábrica segue num processo só, apoiada no que o `pi-durable` já entrega.

## Mapa das decisões

| Decisão | ADR | Fase |
|---|---|---|
| Jaula nas ferramentas, testes dentro dela, sessão na API (D06) | 0023 | 1 |
| Efeito declarado por ferramenta; MCP pelo escritor de efeitos (D01) | 0025 | 1 e 2 |
| Política de ações (D03) | 0024 | 2 |
| Registro de efeitos e webhook como aviso (D05) | 0026 | 2 e 3 |
| Token do App para escrever no GitHub | 0027 | 3 |
| Modelo fixo, orçamento e escalada (D02) | 0028 | 4 |
| Tipo de mudança define a evidência (D07 e D08) | 0029 | 4 |
| Retrô fora do caminho da entrega (D09) | 0030 | 4 |
| Um documento de estado por Tarefa | 0031 | 5 |
| Concorrência por repositório no daemon (D04) | 0032 | 5 |

## Regras de execução

- **Uma fatia, um PR.** A numeração (1.1, 1.2, …) é a ordem. As fases 1 a 4 são obrigatórias nessa ordem; a fase 5 depende de uma medição.
- **Teste primeiro, pelo seam do `CONTRIBUTING.md`:** a fábrica montada com fakes e exercitada pela API (`test/harness.ts`); suíte de contrato para cada porta; nunca internals.
- **Regra nova mora em pacote** de `src/packages/` (ler o `README.md` de lá antes).
- **Antes de cada PR:** `npm run typecheck`, `npm run lint`, `npm test` e `npm run lint:boundaries`.
- **Configuração antiga continua lida.** Toda mudança de schema aceita o formato anterior e o converte.
- **Ensaio antes do real.** Fatia que muda o que a fábrica escreve fora dela passa por um ensaio em dry-run, com `FACTORY_STATE_PATH` separado (`AGENTS.md`).
- **Ao fechar a fase:** trocar o `Estado` das ADRs para "implementada", atualizar o `GLOSSARY.md` e o `CONTRIBUTING.md`.

## Fase 0: preparar e medir

Três fatias pequenas, sem mudança de comportamento, que dão a linha de base para as outras.

**0.1 Fixar a versão do motor.** Em `package.json`, os pacotes `@earendil-works/*` saem de `^1.5.0` para `1.5.0` (ADR-0001). Pronto quando `npm ci` instala as mesmas versões e a suíte passa.

**0.2 Fechar as permissões do estado.** O daemon passa a criar o diretório de estado com `0700` e os arquivos com `0600`, e corrige o que já existe na subida. Teste: subir com um diretório temporário e conferir os modos.

**0.3 Medir a fila e o custo.** Uma função pura, num pacote novo `src/packages/metricas/`, lê os eventos `task` (que têm `at`) e calcula, por Tarefa: tempo até o PR/MR; tempo em cada espera (pessoa, veto, entrega, fila); **tempo enfileirada enquanto outra Tarefa estava ativa**; chamadas de modelo e tokens, com a parte gasta em retrôs. Exposta em `GET /metricas` e numa tabela da página. Pronto quando roda sobre uma cópia do banco real e mostra os números. Esses números são a linha de base da fase 4 e o portão da fase 5.

## Fase 1: fechar a jaula

Realiza a ADR-0023 e a parte de MCP da ADR-0025.
**1.1 Raiz mínima no sandbox.** Em `src/sandbox.ts`, `argumentosDoSandbox` passa a usar só montagens explícitas: `/usr` só para leitura, os atalhos `/bin`, `/lib`, `/lib64` e `/sbin`, o mínimo de `/etc` (`passwd`, `group`, certificados), `/proc`, `/dev`, `/tmp` e `/home` vazios, o clone e a home descartável graváveis. `--unshare-all` no lugar dos três `--unshare-*`. O `node` vem do `mise`, dentro da home, e por isso depende da declaração de caminhos (ver 1.2).
Testes (`test/sandbox.test.ts`): um comando na jaula não lê um arquivo-sentinela criado fora do clone, não lista a home real, escreve no clone e não tem rede.

**1.2 Caminhos de ferramentas por projeto.** Novo bloco `sandbox` na configuração do projeto: `leitura` (diretórios absolutos montados só para leitura) e `path` (entradas acrescentadas ao `PATH`). A validação ao salvar recusa caminho inexistente e qualquer caminho que contenha o diretório de estado, o de configuração ou o cofre. A interface ganha o campo na configuração do projeto. Teste: com o caminho do `node` declarado, a suíte de um repositório de teste roda na jaula; sem ele, a Tarefa bloqueia com o diagnóstico "comando não encontrado".

**1.3 Testes dentro da jaula.** Novo `createSandboxTestRunner()`, que implementa `TestRunner` sobre o `bwrap` com argv fixo, sem shell. `src/factory.ts:350` passa a usá-lo; `createHostTestRunner` fica só para a suíte da própria fábrica, injetado pelo harness. O formatador e a verificação TDD (`src/implement-verificacao.ts`) já usam o mesmo executor e vão junto. Sem `bwrap`, o projeto ganha uma pendência bloqueante e fica incompleto.
Testes: uma suíte que tenta ler o sentinela falha; uma que tenta alcançar a porta da API falha; ao matar o daemon, nenhum processo da suíte sobrevive (`--die-with-parent`).

**1.4 Instalação de dependências como preparação.** A recuperação de ambiente (`src/implement-verificacao.ts`) instala as dependências quando a linha de base falha por pacote ausente. O passo de instalação é um segundo perfil da jaula, "preparação": a mesma raiz mínima, com rede e sem segredos, usado só para instalar dependências sobre o commit da base. Ele não roda depois que existe commit do modelo no clone. O recibo `environmentRecovery` continua. Teste: repositório com dependência ausente se recupera; com um commit do modelo no clone, a preparação é recusada.

**1.5 Filtro de segredos no diff.** `src/secrets.ts` ganha uma função de detecção (hoje só existe `redactSecrets`). Antes do push, em `pushBranch` (`src/effect-writer-codigo.ts`), o diff entre a base e o HEAD passa por ela; um achado gera evento `blocked` e bloqueia a Tarefa, sem repetir o valor no motivo. Teste: um commit com uma chave de exemplo não é publicado.

**1.6 Sessão na API.**
- O segredo fica em `<diretório de estado>/sessao-api`, `0600`, criado na primeira subida. O daemon não o imprime no log.
- `GET /entrar?t=<segredo>` grava um cookie `HttpOnly; SameSite=Strict` e redireciona para `/`. Um script novo, `npm run web`, lê o arquivo e abre o navegador.
- `src/packages/api-local/lib/guardas.ts` ganha a checagem de sessão. Ficam livres só `GET /daemon` (a conferência de saúde do `AGENTS.md`), `GET /openapi.json`, `/entrar` e os assets da página de entrada. O SSE usa o mesmo cookie.
- Clientes que não são navegador mandam `Authorization: Bearer <segredo>`.
- `test/harness.ts` abre sessão. O Telegram não muda, porque chama os comandos dentro do processo.

Testes: POST sem sessão responde 401; com sessão funciona; com sessão e `Origin` estranha continua barrado; `GET /daemon` segue livre.

**1.7 MCP com efeito declarado.**
- Em `src/config-agentes.ts`, as ferramentas MCP de uma etapa passam de lista de nomes para `{ nome, efeito: "leitura" | "externo" }`. Um nome sozinho (formato antigo) é lido como "sem classificação": a ferramenta fica desligada e aparece numa pendência de aviso.
- Em `src/mcp-etapa.ts`, a ferramenta `externo` deixa de chamar o servidor direto. Ela acha a Tarefa pela conversa (como `workspaceOf` faz) e passa por um método novo do escritor de efeitos, que aplica guardrail, dry-run e registro. Em dry-run, o modelo recebe "registrado, não executado".
- Uma extensão com hook `beforeTool` barra qualquer ferramenta MCP sem classificação, como segunda barreira.
- O formulário sugere o efeito a partir de `readOnlyHint`, e o usuário confirma.

Teste: projeto em dry-run com um servidor MCP falso de escrita; o servidor não recebe a chamada e sai um evento `write` com `dryRun: true`.

**Pronto quando:** os testes acima passam; num ensaio, um teste malicioso num repositório de sandbox não lê `~/.ssh`, não alcança a porta 7420 e não sobrevive ao daemon; o `CONTRIBUTING.md` descreve a jaula e as garantias dela.

## Fase 2: uma decisão por efeito

Realiza a ADR-0024 e a parte de saída da ADR-0026. Não muda o que a fábrica faz; muda onde a decisão é tomada e onde fica gravada.

**2.1 Registro de efeitos.** Pacote novo `src/packages/efeitos/` com a regra pura: identificador determinístico (Tarefa, passo, ação, destino e hash do conteúdo), a forma do efeito e os estados (`reservado`, `confirmado`, `incerto`, `registrado`). `criarMotorDeEscrita` (`src/escrita-efeitos.ts`) passa a seguir uma sequência só: guardrail, consulta ao registro, reserva no commit durável, execução, confirmação. O registro fica na Tarefa e substitui a varredura de `events.list()` do dry-run. Os eventos `write` e `blocked` continuam saindo, porque a interface os usa.

Forma de cada ação de hoje:

| Ação | Forma |
|---|---|
| `upsertComment`, `editComment`, `commentOnce`, `mention` | convergente (procura o comentário próprio antes de escrever) |
| `transition`, `dismiss` | convergente (confere o estado do card) |
| `pushBranch`, `ensureRequest` | convergente (compara a ref remota; procura o PR/MR da branch) |
| `openRetroIssue`, `commentRetroIssue` | com marca (já levam a origem no texto) |
| aviso no Teams, ferramenta MCP `externo` | única |
| `comment` sem `once` | revisar cada uso; vira `commentOnce` ou ganha marca |

**2.2 Um só lugar para o incerto.** `Question.publication`, `Question.reminder`, `Question.teamsNotice` e `Question.forwarding` (`src/estado-fabrica.ts`) passam a ser lidos do registro de efeitos. `src/task-view.ts` continua devolvendo os campos atuais, derivados, até a página ser atualizada. Um efeito `incerto` gera um aviso ao usuário e duas ações na página: "saiu" e "não saiu".

**2.3 Política de ações.** Pacote novo `src/packages/politica-acoes/`, com `resolver(politica, ação, contexto)`, que devolve `executar`, `previa`, `registrar` ou `proibir` e aplica os mínimos fixos. A configuração ganha o bloco `acoes`; sem ele, a política é derivada das chaves de hoje:

| Chave atual | Política derivada |
|---|---|
| `dryRun: true` | tudo `registrar` |
| `questionApproval` | `pergunta: previa` |
| `specApproval` | `spec: previa` |
| `source.triageApproval` | `baixa: previa` |
| (fixo) | `publicacao-publica: previa`; merge e branch protegida `proibir` |
| (padrão) | `ferramenta-externa: previa`; `assumir`, `codigo` e `aviso`: `executar` |

O motor de escrita chama o resolvedor logo depois do guardrail. Quando a resposta é `previa`, o efeito vira uma prévia pendente na Tarefa e o passo devolve `aguardar`.

**2.4 Uma prévia só.** Os registros de aprovação de hoje (`specReview` e `specApprovedDryRun`, `triage.review`, o rascunho da pergunta e a prévia de retrô em `src/management-publicacao.ts`) passam a ser uma lista de prévias por efeito, cada uma com hash do conteúdo, destino e modo. As rotas atuais de aprovar continuam e passam a apontar para ela; entra uma rota genérica de prévias da Tarefa.

**2.5 Interface.** A configuração do projeto mostra a tabela de ações. A página da Tarefa mostra as prévias pendentes num lugar só.

**Mudança de comportamento a decidir nesta fase:** hoje, com `questionApproval` ligado e `specApproval` desligado, se o modelo não faz pergunta, o ensaio bloqueia em vez de publicar a SPEC. Com a tabela, essa regra especial some: a SPEC segue o que a linha `spec` disser.

**Pronto quando:** os testes atuais de dry-run e das quatro prévias passam sem mudar de expectativa, fora a regra acima; e, matando o processo entre a reserva e a confirmação, um efeito convergente é refeito sem duplicar, um com marca não duplica, e um único fica `incerto` sem reenvio.

## Fase 3: entrada por reconciliação e escrita pelo App

Realiza a parte de entrada da ADR-0026 e a ADR-0027.

**3.1 Webhook como aviso.** Em `src/github-webhook.ts`, `src/factory-github.ts` e no pacote `sincronizacao-github`, uma entrega `issues` vira um pedido de reconciliação com o id do repositório e o número da issue. O receptor enfileira o pedido pelo escalonador (`sincronizar`) e responde. A reconciliação lê a issue atual no GitHub (uma resposta 404 ou 410 quer dizer apagada) e aplica o resultado pelo caminho que já existe. Rajadas do mesmo repositório são agrupadas por dois segundos. `FactoryState.deliveries` deixa de ser gravado. Eventos de instalação relêem a instalação antes de desativar ou reativar um projeto.
Testes (`test/webhook-recebimento.test.ts`): entrega repetida não muda nada; entrega antiga depois de uma nova não regride o estado; um payload com conteúdo diferente do remoto não vale, vale o remoto; issue apagada cancela a Tarefa.

**3.2 Identidade de escrita.** As portas `DemandSource` e `CodeHost` passam a dizer quem escreve: o usuário ou o bot do App. `src/effect-writer.ts` usa essa identidade onde hoje compara o autor com o usuário (`comentarioIgual`, `upsertComment`, `editComment`), e aceita as duas durante a transição, para reconhecer comentários antigos. A checagem de dono do card (`cardNotOwned`) não muda.

**3.3 Token de instalação.** `src/github-app.ts` já tem `tokenDaInstalacao`, sem uso. Ele passa a pedir o token restrito ao repositório e às permissões necessárias, com cache em memória por até 50 minutos. Os adaptadores do GitHub (`src/github-demand-source.ts`, `src/request-code-host.ts`, `src/git-code-host.ts`) recebem um provedor de credencial: o `gh` roda com `GH_TOKEN` no ambiente do processo filho, e o push vai para a URL HTTPS explícita com um cabeçalho de autorização efêmero, sem tocar a configuração do clone. Toda saída de erro passa pelo filtro de segredos.

**3.4 Escolha por projeto.** Novo campo `escritaGitHub`: `app` ou `usuario`. Projetos novos nascem com `app`; os existentes ficam em `usuario`, com um aviso, até o usuário trocar. Um projeto em `app` sem instalação que cubra o repositório tem pendência bloqueante.

**3.5 Proteção de branch.** A validação do projeto e o painel do App consultam as regras da branch padrão. Sem proteção, sai uma pendência de aviso, que não bloqueia. O `CONTRIBUTING.md` passa a listar as permissões do App.

**3.6 Contratos.** As suítes de contrato da Fonte e do CodeHost rodam nas duas identidades, com um `gh` falso que falha quando `GH_TOKEN` não vem.

**Pronto quando:** num repositório de teste com o App instalado, a fábrica abre o PR como bot, sem usar o login do `gh` do usuário, e o GitHub recusa um push na branch padrão feito com esse token.

## Fase 4: custo e prova

Realiza as ADR-0028, 0029 e 0030.

**4.1 Métricas na Tarefa.** Ao fim de cada etapa, a fábrica grava na Tarefa o que `metricasDaEtapa` já calcula do trace, mais recusas, rodadas de review e o modelo usado. `GET /metricas/modelos` agrega por modelo e etapa, e a página mostra a tabela.

**4.2 Orçamento.** Novo bloco `orcamento` na configuração do projeto (tokens, minutos ativos e tentativas), com padrões. O gasto é a soma de `pi.usage` das conversas da Tarefa mais o tempo em `ativa`. A conferência acontece no começo de cada passo e antes de cada pedido ao modelo. Ao estourar, a Tarefa fica `bloqueada`, com o gasto no motivo; retomar com um orçamento maior continua do checkpoint. Teste: um modelo roteirizado que gasta acima do limite para a Tarefa antes do pedido seguinte.

**4.3 Modelo de escalada.** A configuração da etapa ganha `escalada` (o modelo e depois de quantas recusas). No pacote `tdd-etapa`, onde hoje vale `MAX_RECUSAS_TDD`, a etapa troca de modelo uma única vez ao chegar nesse número, zera as recusas e grava o modelo usado. `src/review-stage.ts` compara a família do reviewer com o modelo usado, e não com o configurado. A validação ao salvar exige o provedor da escalada entre os permitidos do projeto.

**4.4 Retrô fora do caminho.** Em `src/passos-tarefa.ts`, `NEXT` deixa de passar pelos passos `retro-*`. As fases continuam definidas em `createTarefaTask` e só avançam, para as Tarefas que estiverem nelas. Ao fim da Tarefa, uma regra pura no pacote `retro-etapa` decide se há sinal ou se a Tarefa caiu na amostra; em caso positivo, nasce uma task durável em segundo plano com a retrô consolidada. `retroApproval` continua aceito na leitura e não faz mais nada. Novo campo `retro.amostra` (padrão: uma em cada cinco).

**4.5 Versão do contexto.** Cada etapa grava na Tarefa o hash do conhecimento do projeto, do prompt adicional e das skills com que rodou. As métricas da 4.1 passam a poder ser comparadas por versão.

**4.6 Tipo de mudança.** `entregar_spec` ganha o campo `tipo`. A configuração ganha `mudancas`, com duas listas de globs: `documentacao` (padrão: `**/*.md`, `docs/**`) e `sensiveis` (padrão: migrações, `.github/workflows/**`, infraestrutura). Pacote novo `src/packages/evidencia/`, com `tipoEfetivo(declarado, caminhos do diff, regras)` e `evidenciaExigida(tipo)`.

**4.7 Evidência por tipo na implementação.** Documentação: sem fases de teste e de implementação; um commit por ticket, suíte verde e formatador. Comportamento: o ciclo de hoje. O caminho especial das correções já atendidas (`verifiedTickets`) passa a ser um caso da mesma regra.

**4.8 Conferência no diff.** Antes do review e antes de publicar, a fábrica calcula o tipo efetivo no diff entre a base e o HEAD. Se a exigência sobe para comportamento, a Tarefa volta à implementação com o motivo. Se sobe para alto risco, a ação `codigo` passa a `previa` para aquela Tarefa. `isReviewedBranch` passa a exigir o conjunto de evidência do HEAD atual.

**4.9 Glossário.** Atualizar `Retrô`, tirar `Classe` e corrigir a lista de `Papel`.

**Pronto quando:** comparado com a linha de base da fase 0, o número de chamadas de modelo por Tarefa cai; nenhuma Tarefa passa do orçamento sem parar; e uma Tarefa só de documentação é entregue sem teste artificial.

## Fase 5: paralelizar, se a medição pedir

Realiza as ADR-0031 e 0032. Só começa se a medição da fase 0 mostrar que vale.

**5.0 Portão.** Rodar a medição sobre algumas semanas de uso real. Critério sugerido, a confirmar com o usuário: seguir se a espera atrás de outra Tarefa ativa passar de 20% do tempo até o PR, na mediana. Abaixo disso, a fase para aqui e as duas ADRs são marcadas como adiadas.

**5.1 Acesso por um pacote.** Hoje há 83 referências a `.tasks` em 37 arquivos de `src/`. Todas passam a usar funções do pacote `tarefa` (ler, alterar, listar a fila, criar), em fatias por módulo: escalonador; webhook e sincronização; etapas; perguntas; gestão e API. O armazenamento não muda nesta fatia. Uma regra do `depcruise` barra o acesso direto.

**5.2 Documento por Tarefa.** `defineDocFamily` de escopo de sessão, com o id da Tarefa como chave. `StateDoc.tasks` vira o índice da fila. A migração roda na subida, num commit, depois de uma cópia do banco. O documento da Tarefa deixa de ser regravado inteiro a cada alteração. Teste: um banco de fixture no formato antigo sobe, e a API devolve as mesmas Tarefas.

**5.3 Identidade canônica do repositório.** Uma função única devolve a chave do repositório de um projeto: o id do GitHub quando conhecido; senão host, dono e nome do remoto em minúsculas; senão o caminho real.

**5.4 Escalonador.** Em `src/packages/escalonador/` (`agendar` e `ativarTarefa`), a ativação passa a exigir que não haja Tarefa ativa com a mesma chave de repositório e que o número de ativas esteja abaixo do teto (padrão: duas). O executor de testes da jaula ganha um semáforo de uma suíte por vez. Revisar o que supõe uma única ativa: `src/github-webhook.ts` (`EXECUTING`), `src/repositorios.ts` (`tarefasAtivas`), o registro de mudanças do escalonador e a fila da página.

**5.5 Ensaio.** Dois projetos em repositórios diferentes avançam juntos em dry-run; dois projetos no mesmo repositório se excluem.

**Pronto quando:** a medição, repetida, mostra queda na espera sem piora de regressões nem de retrabalho.

## Riscos e pontos a confirmar

- **Jaula e ferramentas.** Cada projeto precisa declarar os caminhos das ferramentas que ficam fora de `/usr`. Testes que usam serviços do host param de funcionar. `--unshare-all` exige namespaces de usuário no host.
- **`pi-durable`.** O hook `beforeTool`, as famílias de documentos e as tasks em segundo plano constam da documentação da versão 1.5.0, mas não foram exercitados aqui. Confirmar com um teste pequeno antes da 1.7, da 4.4 e da 5.2.
- **GitHub App.** O App instalado pode não ter as permissões de escrita; aceitar as novas é um passo manual do usuário. Não foi verificado aqui se PRs abertos pelo bot disparam o CI de cada repositório. Proteção de branch não existe em todo plano.
- **Mudanças que o usuário vai notar:** a API passa a exigir sessão (scripts e agentes que a usam precisam do segredo); o PR sai em nome do bot; some a retrô por etapa; some a regra especial de ensaio da fase 2.
- **Limite do provedor na fase 5.** Não há semáforo por provedor. Se duas Tarefas no mesmo plano gerarem recusas por limite, acrescentar um.
- **Prazos.** Este plano não estima duração.

## Como saber se ficou melhor

| Métrica | Como comparar | Fase que deve movê-la |
|---|---|---|
| Arquivos e rede ao alcance do código do modelo | ensaio com teste malicioso | 1 |
| Efeitos duplicados ou incertos | matar o processo em cada ponto de escrita | 2 |
| Alcance das credenciais no GitHub | repositórios que o token alcança | 3 |
| Chamadas de modelo e tokens por Tarefa entregue | mediana, por tipo de mudança | 4 |
| Correções pedidas por pessoas e Tarefas reabertas | por modelo e por versão do contexto | 4 |
| Tempo até o PR/MR e espera na fila | mediana e p95, separando as esperas | 5 |
