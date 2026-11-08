// Smoke de leitura contra o daemon local. Bloqueia POSTs para não executar ações reais.
// Requer playwright-cli instalado e o daemon em http://127.0.0.1:7420/.
import { execFileSync } from "node:child_process";

const session = `-s=factory-redesign-check-${process.pid}`;
const run = (...args) => {
  const output = execFileSync("playwright-cli", [session, ...args], { encoding: "utf8", timeout: 60000 });
  process.stdout.write(output);
  if (/### Error\b/.test(output)) throw new Error("Playwright reportou falha");
};
run("open", "http://127.0.0.1:7420/");
try {
  run("run-code", `async (page) => {
    await page.route("**/*", route => route.request().method() === "POST" ? route.abort() : route.continue());
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload();
    await page.locator("#alternar-daemon:not([disabled])").waitFor();
    const total = Number(await page.locator("#total-todas").textContent());
    if (await page.locator(".cartao").count() !== total) throw Error("Lista inicial incorreta");
    await page.locator("[data-filtro=atencao]").click();
    await page.waitForFunction(() => document.querySelectorAll(".cartao").length === Number(document.querySelector("#total-atencao").textContent));
    await page.locator("#busca-tarefas").fill("__sem_resultados__");
    if (!await page.locator("#fila-vazia").isVisible()) throw Error("Estado vazio ausente");
    await page.locator("#busca-tarefas").fill("");
    await page.locator("[data-filtro=todas]").click();
    await page.locator("[data-modo=quadro]").click();
    if (await page.locator(".coluna").count() !== 6) throw Error("Etapas ausentes");
    await page.locator("[data-modo=lista]").click();
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error("Overflow em " + width);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    if (total > 0) {
      await page.locator(".cartao").first().click();
      await page.locator("#detalhe").waitFor();
      if (await page.locator("#fluxo-tarefa").getAttribute("open") !== null) throw Error("Pipeline deve iniciar recolhido");
      await page.locator("#fluxo-tarefa summary").click();
      if (!await page.locator("#detalhe-pipeline").isVisible()) throw Error("Pipeline indisponível");
      await page.locator("#fluxo-tarefa summary").click();
      if (await page.locator("#menu-acoes-tarefa").isVisible()) {
        await page.locator("#menu-acoes-tarefa summary").click();
        if (!await page.locator("#detalhe-acoes").isVisible()) throw Error("Ações indisponíveis");
        await page.locator("#menu-acoes-tarefa summary").click();
      }
      for (const tab of await page.locator("[role=tab]").all()) {
        await tab.click();
        if (!await page.locator("#" + await tab.getAttribute("aria-controls")).isVisible()) throw Error("Painel ausente");
      }
      await page.locator("[data-aba=implementacao]").click();
      if (!await page.getByRole("heading", { name: "Registros recentes de execução" }).isVisible()) throw Error("Registros de implementação ausentes");
      if ((await page.locator("#detalhe-implementacao").textContent()).includes("Ainda não começou.")) throw Error("Estado genérico de implementação");
      await page.locator("[data-aba=atividade]").focus();
      await page.keyboard.press("ArrowRight");
      if (await page.locator("[aria-selected=true]").getAttribute("data-aba") !== "spec") throw Error("Teclado falhou");
      await page.locator("#fechar-detalhe").click();
      await page.locator("#detalhe").waitFor({ state: "hidden" });
    }
    await page.locator(".topo .menu-config summary").click();
    await page.locator("#configurar-retros").click();
    await page.locator("dialog").waitFor();
    await page.keyboard.press("Escape");
    await page.locator("dialog").waitFor({ state: "hidden" });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error("Overflow escuro");
  }`);
} finally {
  run("close");
}
