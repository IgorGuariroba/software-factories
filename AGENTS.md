# Orientações para agentes

## Contexto

Este repositório implementa a Fábrica de Software: um daemon com API HTTP e web local que processa tarefas de fontes como Jira e GitHub.

- Antes de alterar código, leia `CONTRIBUTING.md` para convenções e testes.
- Ao alterar conceitos ou fluxo de trabalho, consulte `GLOSSARY.md` e as decisões pertinentes em `docs/adr/`.
- Pacotes em `src/packages/` são módulos profundos: leia `src/packages/README.md` antes de criar ou importar um.

## Subir o daemon

1. Confira se já existe uma instância respondendo em `http://127.0.0.1:7420/daemon`; reutilize-a quando apropriado. Não inicie duas instâncias sobre o mesmo banco SQLite.
2. Confira a configuração antes de iniciar: o daemon pode executar ações reais nos sistemas integrados. Para ensaios, siga a seção de demo em dry-run de `CONTRIBUTING.md`, com `dryRun: true` e um `FACTORY_STATE_PATH` separado.
3. Com dependências instaladas (`npm ci`, se necessário), execute `npm start` na raiz. Em uma sessão de agente, use execução em background com acompanhamento do log.
4. Considere a inicialização concluída somente quando aparecer `[fábrica] API local em ...` no log e `GET /daemon` responder com sucesso. A interface web fica em `http://127.0.0.1:7420/` por padrão.
5. Ao encerrar uma instância iniciada por você, envie SIGTERM ou SIGINT para permitir o fechamento do estado durável.

Configuração de inicialização em `src/main.ts`:

- `FACTORY_CONFIG_DIR`: padrão `~/.config/software-factory/projects`; contém os YAMLs e o conhecimento dos projetos.
- `FACTORY_STATE_PATH`: padrão `~/.local/state/software-factory/fabrica.sqlite`. Preserve o banco existente; use outro caminho para testes isolados.
- `FACTORY_PORT`: padrão `7420`.
- `FACTORY_POLL_SECONDS`: padrão `300`.

Sem as variáveis do Telegram, o daemon funciona apenas com a API/web local. Para autenticação dos modelos e integrações, consulte `CONTRIBUTING.md` e o adaptador correspondente; mantenha segredos fora dos arquivos versionados e dos logs.

## Validação de mudanças

Execute os checks pertinentes de `package.json`: `npm run typecheck`, `npm run lint` e `npm test`. Testes contra serviços reais são opt-in; use os fakes por padrão, conforme `CONTRIBUTING.md`.

## Agent skills

### Issue tracker

Issues no GitHub (`IgorGuariroba/software-factories`), operadas pelo `gh`. Ver `docs/agents/issue-tracker.md`.

### Triage labels

Rótulos padrão: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. Ver `docs/agents/triage-labels.md`.

### Domain docs

Layout single-context: `GLOSSARY.md` e `docs/adr/` na raiz. Ver `docs/agents/domain.md`.
