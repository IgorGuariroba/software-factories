// Regressão na interface pública via Playwright CLI. Nenhum POST chega ao daemon.
const { execFileSync } = require("node:child_process");
const code = async (page) => {
  await page.route("**/*", async (route) => {
    if (!["GET", "HEAD"].includes(route.request().method())) return route.abort();
    return route.continue();
  });
  await page.route("**/tasks/sf/SF-26", async (route) => {
    const response = await route.fetch();
    const task = await response.json();
    await route.fulfill({ json: {
      ...task, status: "pausada", specReview: "approved",
      retros: [{ stage: "spec", status: "concluida", summary: "Retrô de validação", proposals: [
        { n: 1, kind: "fabrica", status: "pendente", title: "Melhoria opcional", description: "Sugestão pública" },
        { n: 2, kind: "conhecimento", status: "pendente", title: "Conhecimento opcional", description: "Sugestão local" },
      ] }],
    } });
  });
  await page.route("**/tasks/sf/SF-26/retros/spec/1", (route) => route.fulfill({
    status: 409, contentType: "application/json", body: JSON.stringify({ error: "repositório da fábrica não configurado" }),
  }));
  await page.goto("http://127.0.0.1:7420/#/tarefa/sf/SF-26");
  await page.getByRole("button", { name: "Retomar tarefa", exact: true }).waitFor();
  const next = await page.locator("#detalhe-proximo").innerText();
  if (!next.includes("sugestões da retrô são opcionais")) throw new Error("Pausa não distingue sugestões opcionais");
  await page.getByRole("tab", { name: /Retrôs/ }).click();
  await page.getByRole("heading", { name: "Sugestões opcionais da retrô" }).waitFor();
  await page.getByText("Aprovação de conhecimento ainda não disponível", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Revisar publicação pública" }).click();
  await page.getByText("Publicação opcional indisponível:", { exact: false }).waitFor();
  if (await page.locator("#aviso").isVisible()) throw new Error("Erro opcional vazou para alerta global");
  if (!(await page.getByRole("button", { name: "Retomar tarefa", exact: true }).isEnabled()))
    throw new Error("Publicação opcional bloqueou retomada");
};
const session = "retro-regression";
try {
  execFileSync("playwright-cli", [`-s=${session}`, "open", "http://127.0.0.1:7420/"], { encoding: "utf8" });
  const output = execFileSync("playwright-cli", [`-s=${session}`, "run-code", code.toString()], { encoding: "utf8" });
  process.stdout.write(output);
  if (output.includes("### Error")) process.exitCode = 1;
} finally {
  execFileSync("playwright-cli", [`-s=${session}`, "close"], { encoding: "utf8" });
}
