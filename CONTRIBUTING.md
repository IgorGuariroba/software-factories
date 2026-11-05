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
| `pre-commit` | bloqueia commit direto em `main`/`master`; conflict markers; arquivos novos > 500 KB; **gitleaks** nas mudanças staged |
| `pre-push` | bloqueia push para `main`/`master`; **gitleaks** nos commits enviados; `tsc --noEmit` |

- Falso positivo do gitleaks: comentário `gitleaks:allow` na linha, ou fingerprint em `.gitleaksignore`.
- Segredo real detectado: remova-o **e rotacione-o**: se já foi commitado, continua no histórico.
- Commit deliberado na `main`: `ALLOW_MAIN=1 git commit ...` (pula só o branch guard; o gitleaks continua rodando).
- Limite de arquivo: `git config hooks.maxFileKB 1000`.
- Bypass pontual de tudo: `git commit --no-verify` / `git push --no-verify`.
- Desativar: `git config --unset core.hooksPath`.
