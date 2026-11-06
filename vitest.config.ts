import { defineConfig } from "vitest/config";

// A suíte não lê a configuração git da máquina (~/.gitconfig, /etc/gitconfig): um `pushurl`, `insteadOf` ou hook
// global ali redirecionaria os pushes dos repositórios temporários. A fábrica em produção continua usando a do usuário.
export default defineConfig({
  test: {
    env: { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  },
});
