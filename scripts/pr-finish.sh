#!/usr/bin/env bash
# Fecha um PR do jeito do projeto: espera todos os checks do CI ficarem verdes e, depois do merge,
# atualiza a main local e apaga a branch local do PR. Não faz merge e não apaga a branch remota.
#
# Uso: npm run pr:finish -- <numero-do-pr>      (sem número, usa o PR da branch atual)
# Requisitos: gh autenticado, árvore de trabalho limpa.
set -euo pipefail

die() { echo "pr-finish: $*" >&2; exit 1; }

command -v gh >/dev/null || die "gh não encontrado"
[ -z "$(git status --porcelain)" ] || die "árvore de trabalho suja: faça commit ou stash antes"

PR="${1:-}"
if [ -z "$PR" ]; then
  PR="$(gh pr view --json number --jq .number 2>/dev/null)" || die "nenhum PR para a branch atual; passe o número"
fi

INFO="$(gh pr view "$PR" --json state,headRefName,headRefOid,url --jq '[.state,.headRefName,.headRefOid,.url] | @tsv')"
IFS=$'\t' read -r STATE HEAD_BRANCH HEAD_OID URL <<<"$INFO"
echo "PR #$PR ($STATE): $URL"

# 1) Espera todos os checks. `gh pr checks --watch` sai com erro se algum check falhar.
echo "Aguardando checks do CI…"
if ! gh pr checks "$PR" --watch --interval 15; then
  die "há check reprovado no PR #$PR; veja: gh pr checks $PR"
fi
echo "Todos os checks estão verdes."

# 2) Merge é decisão do dono do PR. Sem merge, paramos aqui sem tocar na branch local.
STATE="$(gh pr view "$PR" --json state --jq .state)"
if [ "$STATE" != "MERGED" ]; then
  echo "PR ainda não foi mergeado (estado: $STATE). Rode este comando de novo depois do merge."
  exit 0
fi

# 3) Atualiza a main.
git fetch --quiet origin main
CURRENT="$(git branch --show-current)"
if [ "$CURRENT" != "main" ]; then
  git switch main
fi
git pull --ff-only --quiet origin main
echo "main atualizada em $(git rev-parse --short HEAD)."

# 4) Apaga a branch local do PR, se existir e se for exatamente o commit que foi mergeado.
#    Com squash merge, `git branch -d` recusa (o commit não é ancestral da main); por isso a checagem é
#    pela ponta do PR no GitHub, não pela ancestralidade.
if [ -n "$HEAD_BRANCH" ] && git show-ref --verify --quiet "refs/heads/$HEAD_BRANCH"; then
  LOCAL_OID="$(git rev-parse "refs/heads/$HEAD_BRANCH")"
  if [ "$LOCAL_OID" = "$HEAD_OID" ] || git merge-base --is-ancestor "$LOCAL_OID" "$HEAD_OID"; then
    git branch -D "$HEAD_BRANCH" >/dev/null
    echo "Branch local '$HEAD_BRANCH' apagada."
  else
    echo "Branch local '$HEAD_BRANCH' tem commits que não estão no PR; não apaguei. Revise manualmente." >&2
    exit 1
  fi
else
  echo "Nenhuma branch local '$HEAD_BRANCH' para apagar."
fi
