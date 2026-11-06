# Contribuindo

## Git hooks

Os hooks ficam em `.githooks/` e são ativados automaticamente pelo `npm install` (script `prepare`).
Para ativar manualmente:

```sh
git config core.hooksPath .githooks
```

Requisito: [`gitleaks`](https://github.com/gitleaks/gitleaks) instalado (`sudo pacman -S gitleaks`).
Sem ele os hooks bloqueiam o commit/push (fail closed).

| Hook | Checks |
|---|---|
| `pre-commit` | bloqueia commit direto em `main`/`master`; conflict markers; arquivos novos > 500 KB; **gitleaks** e **Biome** (lint + format) nas mudanças staged |
| `pre-push` | bloqueia push para `main`/`master`; **gitleaks** nos commits enviados; `tsc --noEmit` sobre cada commit enviado (worktree temporário) |

- Falso positivo do gitleaks: comentário `gitleaks:allow` na linha, ou fingerprint em `.gitleaksignore`.
- Segredo real detectado: remova-o **e rotacione-o**: se já foi commitado, continua no histórico.
- Commit deliberado na `main`: `ALLOW_MAIN=1 git commit ...` (pula só o branch guard; o gitleaks continua rodando).
- Limite de arquivo: `git config hooks.maxFileKB 1000`.
- Bypass pontual de tudo: `git commit --no-verify` / `git push --no-verify`.
- Desativar: `git config --unset core.hooksPath`.

## Lint e formatação

[Biome](https://biomejs.dev) (`biome.json`), aplicado a `src/**`, `test/**` e aos JSON da raiz (exceto `package-lock.json`):

- `npm run lint`: checa lint + formatação (o mesmo que a CI roda).
- `npm run format`: corrige o que for automático.

## Testes

[Vitest](https://vitest.dev), em `test/`, rodando na CI:

- `npm test`: roda a suíte.
- Seam principal: a fábrica inteira montada com fakes em memória das portas (`test/fakes/`), exercitada pela API HTTP local (`test/harness.ts`). Teste só comportamento observável, nunca internals: funções internas (descoberta de convenções, resolução do repositório, conversão de formatos) são testadas pelo que mudam no resultado (branch e commits no remoto, Tarefa bloqueada, texto que chega à fábrica).
- Portas: uma suíte de contrato por porta (`test/*.contract.ts`), expressa só pela interface da porta, roda contra o fake e contra o adaptador real com o binário/API falso; contra o sistema real, só opt-in. O que for só do formato de um adaptador e não couber no contrato é testado pela interface pública do adaptador (ex.: `test/fonte-jira.test.ts`, `createJiraDemandSource` com o `acli` falso), nunca chamando helpers internos.
- Escritor de efeitos (`src/effect-writer.ts`): guardrails, saneamento e dry-run testados direto pela interface `EffectWriter` (`test/escritor-de-efeitos.test.ts`).
- Implementação: git real contra um remoto bare temporário (`test/fakes/git-repos.ts`) e o modelo faux roteirizado (`scriptImplementer`); o comando de teste dos repositórios de teste é `node --test`.
- Rodar o daemon localmente: `npm start` (lê `~/.config/software-factory/projects/*.yaml`; o conhecimento de cada projeto em `<configDir>/<projeto>/knowledge.md`; a etapa SPEC usa o modelo de `roles.spec` com as credenciais do pi ou a chave do provedor no ambiente, ex. `ANTHROPIC_API_KEY`; para assinatura Codex, use `provider: openai-codex` e autentique-se no pi com `/login`; o daemon compartilha o armazenamento OAuth do pi e pode atualizar o token; `FACTORY_CONFIG_DIR`, `FACTORY_PORT`, `FACTORY_POLL_SECONDS`, `FACTORY_RETRO_REPO` (repositório público da fábrica para as issues de retrô) e `FACTORY_STATE_PATH` (estado durável, padrão `~/.local/state/software-factory/fabrica.sqlite`) sobrescrevem). Exemplo de config em `projects/example.yaml`. A etapa de implementação clona o repositório mapeado para `<dir do estado>/worktrees/<projeto>/<card>` e nunca mexe na cópia de trabalho mapeada.

### Assumir card "Em Andamento" e veto

Com repositório mapeado, o prazo de veto dá lugar à inspeção do repositório (ADR-0013, `src/prior-work.ts`): a fábrica procura, na cópia local e sem `fetch`, um commit da branch padrão de `origin` que cite a chave do card. Nada encontrado: segue direto para a SPEC. Encontrado: a Tarefa fica `bloqueada` ("card já implementado: o commit …"). Uma branch do card ainda não mergeada é adotada pela implementação. O que segue abaixo vale para cards sem repositório mapeado.

A busca enfileira os cards atribuídos ao usuário em "A Fazer" e em "Em Andamento". Os de "A Fazer" ganham o comentário de assunção e vão para "Em Andamento". Um card que já estava em andamento:

- ganha o mesmo comentário de assunção e um evento `notify` ao usuário (`reason: "aguardando-veto"`, com o fim do prazo em `until`), que as interfaces de gestão encaminham;
- vai para `aguardando-veto`, sai da fila (a próxima avança) e dorme numa task durável de prazo por `vetoMinutes` do projeto (padrão 30) no relógio da fábrica; a espera sobrevive a um reinício;
- `POST /tasks/{projeto}/{card}/veto` (ou `commands.veto` do `RunningFactory`, o mesmo comando das interfaces de gestão) dentro do prazo deixa a Tarefa `vetada`: estado final, ela não escreve mais nada no card. Fora do prazo, ou numa Tarefa que não aguarda veto, a resposta é 409, sem efeito;
- sem veto, a Tarefa volta à fila e, na vez dela, segue para as etapas, sem transição (o card já está em "Em Andamento"). Uma nova tentativa depois de uma falha não abre outro prazo.

### Perguntas ao PO e horas úteis

Na etapa SPEC, o grill pode levar uma pergunta de negócio ao PO pela ferramenta `perguntar_po`. A pergunta sai pela porta `Channel` (`src/channel.ts`); no M1, o único adaptador é um comentário no card dirigido ao PO declarado em `people` (role `po`), sem token de menção (o `acli` grava texto puro e o Jira mostraria `[~accountid:…]` literalmente; o aviso ao PO vai pelo Teams), sempre pelo escritor de efeitos (guardrail de destinatário só entre as pessoas do projeto, prefixo, filtro de segredos e dry-run). Sem PO declarado, a Tarefa fica `bloqueada`.

- A Tarefa vai para `aguardando-humano`, sai da fila (a próxima avança) e dorme numa task durável de prazo.
- Resposta: qualquer comentário do PO no card criado depois da pergunta. Ela é achada a cada busca na Fonte (`POST /poll` ou o timer) e sempre que a Tarefa acorda num prazo; a Tarefa volta à fila e, na vez dela, o grill segue com a resposta no contexto.
- Prazos, em horas úteis do `calendar` do projeto (fuso, dias úteis, expediente e feriados): lembrete ao PO (novo comentário com menção) após 4 h úteis sem resposta e um evento `notify` ao usuário após 1 dia útil (a duração do expediente). As interfaces de gestão (Telegram, web) encaminham o `notify`. Um prazo que se completa exatamente no fim do expediente cai no início do próximo.
- **Card vazio ou raso**: se a descrição, os comentários humanos e os anexos de texto somam menos de 80 caracteres não brancos (`SHALLOW_CARD_MIN_CHARS` em `src/spec-stage.ts`), a fábrica pergunta ao PO antes de chamar o grill.
- No máximo 5 perguntas por Tarefa; na sexta, a Tarefa fica `bloqueada`.
- Dry-run: pergunta e lembrete viram só eventos `write` (`action: "mention"`); a leitura das respostas continua real.
- Nos testes, a fábrica roda num relógio falso (`test/fakes/fake-clock.ts`, opção `clock` de `startTestFactory`), que move o relógio do motor durável e do agendador.

### Web local de gestão

O daemon serve uma página de gestão em `GET /` (abra `http://127.0.0.1:7420/` ou `http://localhost:7420/`), com os assets sob `/web/`. Ela é HTML, CSS e JS puro em módulos (`web/`), sem build nem framework, e só fala com o daemon pela API documentada em `/openapi.json` (`web/api.js` é o único ponto com `fetch`/`EventSource`).

- Mostra a fila (tarefas não encerradas, na ordem, com status e etapa: `assumir`, `veto`, `spec`, `implementacao`), as encerradas e, sob demanda, os cards elegíveis na Fonte (`GET /queue`).
- Detalhe de uma tarefa (`#/tarefa/<projeto>/<card>`, dados de `GET /tasks/{projeto}/{card}`): estado, prazo de veto, perguntas ao PO, SPEC e Tickets entregues, progresso da implementação, as escritas registradas (feitas, do dry-run ou barradas por guardrail) e o histórico de eventos da tarefa.
- Ações: vetar (só no prazo de veto), pausar, retomar, cancelar, subir/descer na fila (`POST /tasks/order`), pausar/retomar o daemon e buscar na Fonte.
- Atualiza-se sozinha pelo SSE (`/events/stream`); o selo no topo mostra se o stream está conectado.
- Segurança: as mesmas proteções da API (Host local e Origin local nos POST); a resposta da página e dos assets leva `Content-Security-Policy` restritiva (`default-src 'self'`, sem script nem estilo inline) e `X-Content-Type-Options: nosniff`; o DOM é montado com `createElement`/`textContent`, nunca com `innerHTML` (o conteúdo vem do card e do modelo).
- Build: `web/` fica na raiz, ao lado de `src/` e `dist/`; o daemon resolve `../web/` relativo ao próprio módulo, então `tsx src/main.ts` e `node dist/main.js` acham a mesma página.
- Testes: `test/web-gestao.test.ts` (pela API: cabeçalhos, cliente local, rotas que o JS chama conferidas contra o `/openapi.json`) e `test/web-view.test.ts` (apresentação pura de `web/view.js`). Não há navegador nos testes.

### Retrô e issues da fábrica

Cada etapa de modelo termina com a sua retrô (hoje: SPEC e implementação; a implementação que não rodou, por falta de repositório mapeado, não tem retrô) e a Tarefa termina com a consolidada, que recebe as retrôs das etapas. Uma etapa nova entra com um passo `retro-<etapa>` em `RETRO_STEP`/`NEXT` (`src/durable.ts`) e o relato dela em `retroInput` (`src/factory.ts`).

- **Modelo**: conversa durável da Tarefa, com entrega estruturada pela ferramenta `entregar_retro` (resumo e propostas classificadas em `fabrica`, `conhecimento` e `repo-time`). Papel `roles.retro`, opcional; sem ele, usa o modelo de `roles.spec`.
- **Visível na API**: `GET /tasks/{projeto}/{card}` traz `retros` (etapa, status, resumo, propostas e o que virou cada uma); a página mostra a seção "Retrôs".
- **fábrica** → proposta pendente, sem bloquear a Tarefa. Na página local, abra a Tarefa, clique em “Revisar publicação pública” e examine o destino, título e texto antes de “Aprovar publicação”. A aprovação vale somente para a prévia exibida; se ela mudar, é preciso revisá-la novamente. A API local pressupõe que processos locais são confiáveis. Após aprovação, a fábrica abre issue com label `retro` ou comenta +1 pela porta `RetroSink` (`src/retro-sink.ts`; adaptador real `gh`, que usa as credenciais do usuário; a label precisa existir). O repositório vem de `FACTORY_RETRO_REPO=dono/nome`; sem ele, a proposta permanece pendente e o daemon avisa no log.
  - **Dedupe**: entre as issues abertas com a label `retro`, a "parecida" é a de maior similaridade de Jaccard entre os tokens dos títulos (minúsculas, sem acento nem pontuação, sem palavras vazias e tokens de uma letra) com pelo menos `SIMILARITY_THRESHOLD` (0,6); no empate, a mais antiga. Parecida → comentário "+1" com o id opaco da Tarefa; nenhuma → issue nova.
  - **Idempotência**: a entrega do modelo é gravada antes de publicar e cada proposta é registrada depois de publicada. O texto leva a marca `Origem: tarefa \`<id>\`, retrô <etapa>, proposta <n>.`; uma retomada que acha a marca numa issue aberta não escreve de novo. Uma Tarefa conta uma vez por issue: se a parecida já cita a Tarefa, nada é escrito (`ja-registrada`).
- **conhecimento do projeto** → proposta `pendente` na Tarefa (a aprovação e a rejeição com motivo são da M1-18, #26).
- **repo do time** → só um evento `notify` (`reason: "sugestao-repo-time"`) ao usuário, que as interfaces de gestão encaminham. Nenhuma issue ou MR no repositório do time.
- **Falhas não bloqueiam a entrega**: uma falha do modelo conta uma tentativa e a Tarefa é tentada de novo como em qualquer erro; na `MAX_RETRO_ATTEMPTS`ª (3), a retrô fica `falhou`, sai um evento `retro` (encaminhado ao Telegram) e a Tarefa segue. A publicação é posterior à entrega: se GitHub falhar, a proposta permanece pendente para o usuário tentar novamente. A prévia com valores privados residuais não pode ser aprovada; o escritor ainda aplica seus guardrails.
- **O repositório da fábrica é público.** Todo texto de issue e de "+1" passa pelo escritor de efeitos (`openRetroIssue`/`commentRetroIssue`), que:
  1. só escreve no repositório de `FACTORY_RETRO_REPO` (outro repositório é barrado com evento `blocked`);
  2. aplica o filtro de segredos;
  3. saneia por código (`src/public-text.ts`): troca por `[removido]` o nome do projeto, a chave do projeto na Fonte e as chaves de card (`CHAVE-123`), o usuário, as pessoas (ids e nomes), os repositórios mapeados (caminho, nome, prefixo) e a chave e o título do card; remove URLs com esquema `://` e caminhos Unix reconhecidos (inclusive de um componente), mas não necessariamente `mailto:`, caminhos Windows ou outros formatos: revise-os manualmente; e impede a publicação se detectar valores privados residuais (por exemplo, uma chave `chave_123` ou uma grafia normalizada de termo privado);
  4. no dry-run, só registra.
  Filtros e instruções ao modelo não garantem anonimização: a revisão humana é obrigatória antes de toda publicação. O modelo recebe a regra de descrever só a fábrica (`RETRO_PUBLIC_RULE`). A Tarefa aparece só pelo id opaco `ref` (aleatório, gravado na Tarefa, sem derivar do projeto nem do card), na marca de origem (tarefa `<ref>`), sem nenhuma URL. Para achar a Tarefa a partir de uma issue, cole o id na página local como `http://127.0.0.1:<porta>/#/retro/<ref>`: ela resolve a Tarefa pelo `ref` de `GET /tasks`.
- **Contrato**: `test/retro-sink.contract.ts` roda contra o fake em memória e contra o adaptador `gh` com um `gh` falso. Contra o GitHub real, só opt-in, num repositório de teste seu (com a label `retro`), nunca no da fábrica: `TEST_RETRO_REPO=seu-usuario/sandbox-retro npx vitest run test/retro-sink-gh.contract.test.ts`.

### Telegram (interface de gestão)

O Telegram é a interface de gestão do celular (porta `ManagementInterface`, `src/management.ts`; adaptador `src/telegram.ts`, Bot API por HTTP com long polling em `getUpdates`, sem webhook). Ele é **global ao daemon** (um bot e uma conversa para todos os projetos); só o nível de conteúdo é por projeto.

- Ambiente (nunca na config, em log ou em erro): `TELEGRAM_BOT_TOKEN` (token do bot, do @BotFather), `TELEGRAM_CHAT_ID` (a conversa onde a fábrica publica e a única de onde aceita comandos) e, opcional, `TELEGRAM_USER_ID` (se definido, só comandos desse usuário naquela conversa valem; recomendado em grupos). Sem token ou sem chat, o daemon sobe sem Telegram, com um aviso no log. O daemon apaga o token do próprio ambiente ao ler, para ele não chegar aos processos filhos.
- Conteúdo, por projeto (`telegram.content` no YAML, ADR-0009): `full` (padrão) manda o texto completo (título do card, avisos, motivos de bloqueio); `minimal` manda só o tipo do evento, o card, o projeto e prazos. Toda mensagem de saída, nos dois níveis, passa pelo filtro de segredos (`src/secrets.ts`). Ela vai ao canal particular do usuário, então não passa pelo escritor de efeitos, que cuida das escritas em sistemas do time (Jira, git, issues públicas); ver a nota do ADR-0002.
- Publicado: assunção de um card (com botões Pausar e Cancelar), avisos `notify` (prazo de veto, com botão Vetar enquanto o prazo vale; pergunta sem resposta), bloqueio de guardrail (`blocked`), Tarefa `bloqueada` e Tarefa concluída. Um card que já estava em andamento recebe só o aviso de veto, que já diz que a fábrica o assumiu.
- Comandos (os mesmos de `RunningFactory.commands`, que a API usa, chamados no próprio processo, sem HTTP): `/vetar <card>`, `/pausar [card]`, `/retomar [card]`, `/cancelar <card>`; sem card, `/pausar` e `/retomar` valem para o daemon. `<card>` é a chave (`PROJ-1`) ou `projeto/chave`. Cada comando recebe resposta no chat (ou no aviso do botão) e vira um evento `command`.
- Origem não autorizada (outro chat ou outro usuário, inclusive tocando um botão): nada é executado nem respondido; fica só o evento `command` com `accepted: false`.
- Durabilidade: o progresso fica no estado durável (`ManagementDoc`): o índice do próximo evento a publicar e o `offset` do `getUpdates`. Um reinício não republica mensagens nem repete comandos (o offset é gravado depois de executar o comando; os comandos são idempotentes). Ao ligar o Telegram pela primeira vez, o histórico anterior não é publicado.
- Falhas: uma mensagem que não sai é tentada de novo em 5 s e em 30 s (relógio da fábrica) e, na terceira falha, é descartada com um evento `delivery` (`status: "descartada"`) e um log; as seguintes continuam saindo. Uma falha ao receber espera 10 s e tenta de novo. Nenhuma falha do Telegram derruba nem trava a fábrica (a publicação corre à parte da fila de Tarefas).
- Limites da Bot API: texto acima de 4096 caracteres é truncado com "…"; botão cujo comando passa de 64 bytes (`callback_data`) é omitido, e o comando continua valendo por texto.

#### Testes de contrato contra o Telegram real (opt-in)

A suíte de contrato da `ManagementInterface` (`test/management.contract.ts`) roda na CI contra o fake em memória (`test/fakes/fake-telegram.ts`) e contra o adaptador real falando com uma Bot API falsa e estrita (`test/fakes/fake-bot-api.ts`). Contra o Telegram real, só com variáveis explícitas, usando um bot e um chat **de teste** (a suíte publica mensagens nele e consome os updates pendentes do bot):

```sh
TEST_TELEGRAM_BOT_TOKEN="token-do-bot-de-teste" \
TEST_TELEGRAM_CHAT_ID="id-do-chat-de-teste" \
npx vitest run test/management-telegram.contract.test.ts
```

Sem as duas variáveis, o arquivo é pulado. Contra o real, os testes de recepção que dependem de simular o usuário são pulados; o bot não pode ter webhook configurado (o `getUpdates` falha com webhook ativo).

### Fonte Jira

O adaptador Jira (`src/jira-demand-source.ts`) fala com o Jira pelo `acli` (Atlassian CLI), já autenticado na máquina (`acli jira auth login`); `ACLI_PATH` aponta para o binário se ele não estiver no `PATH`. Em `source.assignee`, use o seu accountId ou o seu e-mail do Jira.

O `acli` não baixa anexos, então o conteúdo dos anexos de texto é lido por HTTP com autenticação básica:

- `ATLASSIAN_EMAIL`: o e-mail da conta Atlassian.
- `ATLASSIAN_API_TOKEN`: um API token dessa conta (nunca é registrado em log nem em mensagens de erro).

Sem as duas variáveis, cada anexo de texto chega à fábrica com o conteúdo `[conteúdo não lido: defina ATLASSIAN_EMAIL e ATLASSIAN_API_TOKEN]`. Com elas, uma falha no download (HTTP não-ok, erro de rede) falha a leitura do card, e a Tarefa é tentada de novo. O mesmo vale para qualquer falha do `acli` ao ler: a fábrica nunca trata um erro como "sem comentários" ou "card sumiu".

### Testes de contrato contra o Jira real (opt-in)

A suíte de contrato da `DemandSource` roda por padrão (na CI) contra o fake em memória e contra o adaptador Jira com um `acli` falso nos formatos do Jira Cloud (`test/fakes/fake-acli.ts`). Para rodar contra o Jira real fora da CI (usando um projeto e card sandbox):

```sh
TEST_JIRA_PROJECT="SANDBOX" \
TEST_JIRA_ASSIGNEE="seu-id-ou-account-id" \
TEST_JIRA_CARD="SANDBOX-1" \
TEST_JIRA_TRANSITION_FROM="A Fazer" \
TEST_JIRA_TRANSITION_TO="Em Andamento" \
npx vitest run test/demand-source-jira.contract.test.ts
```

Se as variáveis `TEST_JIRA_PROJECT`, `TEST_JIRA_ASSIGNEE` e `TEST_JIRA_CARD` não forem fornecidas, o arquivo é pulado automaticamente (`skipped`) para segurança contra escritas acidentais e independência de credenciais na CI.

### Aviso ao PO no Teams via MCP

O comentário do Jira continua sendo o canal da pergunta e da resposta. Opcionalmente, configure `source.baseUrl` com a origem HTTPS do Jira e `teamsUserId` (MRI `8:orgid:...`) na pessoa com `role: po`. Inicie o daemon com `FACTORY_TEAMS_MCP_COMMAND` apontando para o executável local do servidor `msteams-mcp`, previamente autenticado. A fábrica não usa shell para iniciar o MCP. A mensagem contém o card e seu link, não o conteúdo da pergunta. `dryRun: true` nunca envia o aviso. Quando a entrega não é confirmada, consulte o status `teamsNotice` na API e o chat antes de agir: uma tentativa incerta não é repetida automaticamente, para evitar duplicação. Um processo encerrado durante o envio pode deixar o status `attempted`, também exigindo conferência. Perguntas criadas antes dessa integração não geram aviso retroativo.

Para um ensaio com revisão, `questionApproval: true` registra a pergunta como rascunho; a página da Tarefa mostra o comentário exato e o aviso Teams antes de aprovar. A aprovação é vinculada ao conteúdo e destino exibidos e não executa em dry-run. Com `questionApproval: true`, o lembrete ao PO (4 h úteis) também não sai sozinho: vira rascunho, a fábrica avisa o usuário e a página mostra o texto exato para aprovar. Com `specApproval: true`, a SPEC e os Tickets ficam como rascunho (Tarefa `aguardando-humano`): a página mostra os dois comentários exatos e só a aprovação dessa prévia os publica, quando a Tarefa volta a rodar; em dry-run a aprovação é recusada. Com `questionApproval` sem `specApproval`, se o modelo não fizer pergunta, o ensaio bloqueia em vez de publicar SPEC/Tickets. Atenção: assumir o card e movê-lo para Em Andamento ocorrem **antes** da prévia quando `dryRun` está desligado. Se o processo parar durante a publicação, `sending` indica resultado incerto: verifique o Jira antes de qualquer nova tentativa.

`source.keys`, quando presente, restringe novas entradas da fila às chaves listadas. Essa opção não elimina tarefas que já existem no estado durável; para um ensaio isolado, use obrigatoriamente um `FACTORY_STATE_PATH` novo e confira a fila antes de permitir qualquer escrita.

### Demo em dry-run contra o Jira real

Para testar a fábrica lendo a fila e cards do Jira de verdade sem aplicar nenhuma alteração ou escrita externa:

1. Crie uma pasta temporária para a config local (fora do repositório versionado):
   ```sh
   mkdir -p /tmp/fabrica-demo/sandbox
   ```
2. Crie um arquivo `/tmp/fabrica-demo/sandbox.yaml` baseado em `projects/example.yaml`, definindo `dryRun: true`:
   ```yaml
   name: sandbox
   dryRun: true
   source:
     type: jira
     project: "SANDBOX"
     assignee: "seu-id-no-jira"
   roles:
     spec:
       provider: anthropic
       model: claude-3-7-sonnet-20250219
   statuses:
     "Backlog": backlog
     "A Fazer": todo
     "Em Andamento": in_progress
   ```
3. Crie um `/tmp/fabrica-demo/sandbox/knowledge.md` (pode ser vazio).
4. Inicie o daemon apontando para a pasta criada:
   ```sh
   FACTORY_CONFIG_DIR=/tmp/fabrica-demo \
   FACTORY_STATE_PATH=/tmp/fabrica-demo/demo.sqlite \
   npm start
   ```
5. No log do console e no stream de eventos, o daemon listará a fila real de cards atribuídos a você e registrará no log cada escrita que faria (com prefixo de automação e dados higienizados), sem alterar nada no Jira. O dry-run lembra, no estado durável, as escritas que já registrou: um reinício no meio do ensaio não registra de novo a mesma escrita (mesmo destino, ação e conteúdo).
