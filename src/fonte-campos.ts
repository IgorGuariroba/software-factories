// Campos de configuração que mais de uma Fonte de demanda usa com o mesmo rótulo e a mesma forma. Cada Fonte mantém os
// seus campos próprios; os comuns ficam aqui, para o formulário da interface ser igual nas duas.

/** Credencial: o nome de um segredo guardado no cofre (nunca o valor). */
export const CAMPO_CREDENCIAL = {
  campo: "credential",
  rotulo: "Credencial (nome no cofre)",
  tipo: "segredo",
  obrigatorio: false,
} as const;

/** Labels ignoradas: a lista de rótulos que tiram a issue da fila (GitHub e GitLab). */
export const CAMPO_LABELS_IGNORADAS = {
  campo: "ignoreLabels",
  rotulo: "Labels ignoradas",
  tipo: "lista",
  obrigatorio: false,
} as const;
