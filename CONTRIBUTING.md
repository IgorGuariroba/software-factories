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
- Seam principal: a fábrica inteira montada com fakes em memória das portas (`test/fakes/`), exercitada pela API HTTP local (`test/harness.ts`). Teste só comportamento observável, nunca internals.
- Implementação: git real contra um remoto bare temporário (`test/fakes/git-repos.ts`) e o modelo faux roteirizado (`scriptImplementer`); o comando de teste dos repositórios de teste é `node --test`.
- Rodar o daemon localmente: `npm start` (lê `~/.config/software-factory/projects/*.yaml`; o conhecimento de cada projeto em `<configDir>/<projeto>/knowledge.md`; a etapa SPEC usa o modelo de `roles.spec` com a chave do provedor no ambiente, ex. `ANTHROPIC_API_KEY`; `FACTORY_CONFIG_DIR`, `FACTORY_PORT`, `FACTORY_POLL_SECONDS` e `FACTORY_STATE_PATH` (estado durável, padrão `~/.local/state/software-factory/fabrica.sqlite`) sobrescrevem). Exemplo de config em `projects/example.yaml`. A etapa de implementação clona o repositório mapeado para `<dir do estado>/worktrees/<projeto>/<card>` e nunca mexe na cópia de trabalho mapeada.

### Assumir card "Em Andamento" e veto

A busca enfileira os cards atribuídos ao usuário em "A Fazer" e em "Em Andamento". Os de "A Fazer" ganham o comentário de assunção e vão para "Em Andamento". Um card que já estava em andamento:

- ganha o mesmo comentário de assunção e um evento `notify` ao usuário (`reason: "aguardando-veto"`, com o fim do prazo em `until`), que as interfaces de gestão encaminham;
- vai para `aguardando-veto`, sai da fila (a próxima avança) e dorme numa task durável de prazo por `vetoMinutes` do projeto (padrão 30) no relógio da fábrica; a espera sobrevive a um reinício;
- `POST /tasks/{projeto}/{card}/veto` (ou `commands.veto` do `RunningFactory`, o mesmo comando das interfaces de gestão) dentro do prazo deixa a Tarefa `vetada`: estado final, ela não escreve mais nada no card. Fora do prazo, ou numa Tarefa que não aguarda veto, a resposta é 409, sem efeito;
- sem veto, a Tarefa volta à fila e, na vez dela, segue para as etapas, sem transição (o card já está em "Em Andamento"). Uma nova tentativa depois de uma falha não abre outro prazo.

### Perguntas ao PO e horas úteis

Na etapa SPEC, o grill pode levar uma pergunta de negócio ao PO pela ferramenta `perguntar_po`. A pergunta sai pela porta `Channel` (`src/channel.ts`); no M1, o único adaptador é um comentário no card que menciona o PO declarado em `people` (role `po`), sempre pelo escritor de efeitos (guardrail de destinatário só entre as pessoas do projeto, prefixo, filtro de segredos e dry-run). Sem PO declarado, a Tarefa fica `bloqueada`.

- A Tarefa vai para `aguardando-humano`, sai da fila (a próxima avança) e dorme numa task durável de prazo.
- Resposta: qualquer comentário do PO no card criado depois da pergunta. Ela é achada a cada busca na Fonte (`POST /poll` ou o timer) e sempre que a Tarefa acorda num prazo; a Tarefa volta à fila e, na vez dela, o grill segue com a resposta no contexto.
- Prazos, em horas úteis do `calendar` do projeto (fuso, dias úteis, expediente e feriados): lembrete ao PO (novo comentário com menção) após 4 h úteis sem resposta e um evento `notify` ao usuário após 1 dia útil (a duração do expediente). As interfaces de gestão (Telegram, web) encaminham o `notify`. Um prazo que se completa exatamente no fim do expediente cai no início do próximo.
- **Card vazio ou raso**: se a descrição, os comentários humanos e os anexos de texto somam menos de 80 caracteres não brancos (`SHALLOW_CARD_MIN_CHARS` em `src/spec-stage.ts`), a fábrica pergunta ao PO antes de chamar o grill.
- No máximo 5 perguntas por Tarefa; na sexta, a Tarefa fica `bloqueada`.
- Dry-run: pergunta e lembrete viram só eventos `write` (`action: "mention"`); a leitura das respostas continua real.
- Nos testes, a fábrica roda num relógio falso (`test/fakes/fake-clock.ts`, opção `clock` de `startTestFactory`), que move o relógio do motor durável e do agendador.

### Telegram (interface de gestão)

O Telegram é a interface de gestão do celular (porta `ManagementInterface`, `src/management.ts`; adaptador `src/telegram.ts`, Bot API por HTTP com long polling em `getUpdates`, sem webhook). Ele é **global ao daemon** (um bot e uma conversa para todos os projetos); só o nível de conteúdo é por projeto.

- Ambiente (nunca na config, em log ou em erro): `TELEGRAM_BOT_TOKEN` (token do bot, do @BotFather), `TELEGRAM_CHAT_ID` (a conversa onde a fábrica publica e a única de onde aceita comandos) e, opcional, `TELEGRAM_USER_ID` (se definido, só comandos desse usuário naquela conversa valem; recomendado em grupos). Sem token ou sem chat, o daemon sobe sem Telegram, com um aviso no log. O daemon apaga o token do próprio ambiente ao ler, para ele não chegar aos processos filhos.
- Conteúdo, por projeto (`telegram.content` no YAML, ADR-0009): `full` (padrão) manda o texto completo (título do card, avisos, motivos de bloqueio); `minimal` manda só o tipo do evento, o card, o projeto e prazos. Toda mensagem de saída, nos dois níveis, passa pelo filtro de segredos (`src/secrets.ts`).
- Publicado: assunção de um card (com botões Pausar e Cancelar), avisos `notify` (prazo de veto, com botão Vetar enquanto o prazo vale; pergunta sem resposta), bloqueio de guardrail (`blocked`), Tarefa `bloqueada` e Tarefa concluída. Um card que já estava em andamento recebe só o aviso de veto, que já diz que a fábrica o assumiu.
- Comandos (os mesmos de `RunningFactory.commands`, que a API usa): `/vetar <card>`, `/pausar [card]`, `/retomar [card]`, `/cancelar <card>`; sem card, `/pausar` e `/retomar` valem para o daemon. `<card>` é a chave (`PROJ-1`) ou `projeto/chave`. Cada comando recebe resposta no chat (ou no aviso do botão) e vira um evento `command`.
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
5. No log do console e no stream de eventos, o daemon listará a fila real de cards atribuídos a você e registrará no log cada escrita que faria (com prefixo de automação e dados higienizados), sem alterar nada no Jira.
