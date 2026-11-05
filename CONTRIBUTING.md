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

[Biome](https://biomejs.dev) (`biome.json`), aplicado a `src/**` e aos JSON da raiz:

- `npm run lint`: checa lint + formatação (o mesmo que a CI roda).
- `npm run format`: corrige o que for automático.

## Testes

[Vitest](https://vitest.dev), em `test/`, rodando na CI:

- `npm test`: roda a suíte.
- Seam principal: a fábrica inteira montada com fakes em memória das portas (`test/fakes/`), exercitada pela API HTTP local (`test/harness.ts`). Teste só comportamento observável, nunca internals.
- Rodar o daemon localmente: `npm start` (lê `~/.config/software-factory/projects/*.yaml`; `FACTORY_CONFIG_DIR` e `FACTORY_PORT` sobrescrevem). Exemplo de config em `projects/example.yaml`.
