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
- Rodar o daemon localmente: `npm start` (lê `~/.config/software-factory/projects/*.yaml`; o conhecimento de cada projeto em `<configDir>/<projeto>/knowledge.md`; a etapa SPEC usa o modelo de `roles.spec` com a chave do provedor no ambiente, ex. `ANTHROPIC_API_KEY`; `FACTORY_CONFIG_DIR`, `FACTORY_PORT`, `FACTORY_POLL_SECONDS` e `FACTORY_STATE_PATH` (estado durável, padrão `~/.local/state/software-factory/fabrica.sqlite`) sobrescrevem). Exemplo de config em `projects/example.yaml`.

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
