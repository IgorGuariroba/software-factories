import { afterEach, describe, expect, it } from "vitest";
import { deliverRetro, FakeModel } from "./fakes/fake-model.js";
import { api, hold, poll, startTestFactory, type TestFactory, USER, waitForStatus } from "./harness.js";

let factory: TestFactory | undefined;
afterEach(async () => {
  await factory?.close();
});

describe("configuração web do repositório público de retrôs", () => {
  it("salva pela API, aplica imediatamente e preserva a escolha após reinício", async () => {
    factory = await startTestFactory({ retroRepo: null });
    expect(await api(factory, "GET", "/settings/retro")).toMatchObject({ repo: null });
    expect(await api(factory, "POST", "/settings/retro", { repo: "usuario/fabrica" })).toMatchObject({
      repo: "usuario/fabrica",
    });
    expect(await api(factory, "GET", "/settings/retro")).toMatchObject({ repo: "usuario/fabrica" });
    factory = await factory.restart({ retroRepo: "ambiente/outro" });
    expect(await api(factory, "GET", "/settings/retro")).toMatchObject({ repo: "usuario/fabrica" });
    expect(factory.retroSink.issues).toHaveLength(0);
  });

  it("valida o destino e recusa escrita de outra origem", async () => {
    factory = await startTestFactory({ retroRepo: null });
    for (const repo of ["", "https://github.com/usuario/fabrica", "usuario", "a/b/c", "../.."])
      expect(
        (
          await fetch(`${factory.url}/settings/retro`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ repo }),
          })
        ).status,
      ).toBe(400);
    expect(
      (
        await fetch(`${factory.url}/settings/retro`, {
          method: "POST",
          headers: { origin: "https://outro.example", "content-type": "application/json" },
          body: JSON.stringify({ repo: "usuario/fabrica" }),
        })
      ).status,
    ).toBe(403);
    expect(await api(factory, "GET", "/settings/retro")).toMatchObject({ repo: null });
  });

  it("habilita prévia imediatamente e exige nova revisão se o destino mudar", async () => {
    const model = new FakeModel();
    model.respondRetro = () =>
      deliverRetro("Resumo", [
        { tipo: "fabrica", titulo: "Melhorar validação", descricao: "Revisar dados antes da escrita." },
      ]);
    factory = await startTestFactory({
      retroRepo: null,
      model,
      cards: [{ key: "PROJ-1", title: "Demanda", status: "A Fazer", assignee: USER }],
    });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    await api(factory, "POST", "/settings/retro", { repo: "usuario/primeiro" });
    const path = "/tasks/exemplo/PROJ-1/retros/spec/1";
    const preview = await api<{ repo: string; revision: string }>(factory, "GET", path);
    expect(preview.repo).toBe("usuario/primeiro");
    await api(factory, "POST", "/settings/retro", { repo: "usuario/segundo" });
    expect(
      (
        await fetch(`${factory.url}${path}/approve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ revision: preview.revision }),
        })
      ).status,
    ).toBe(409);
    const current = await api<{ repo: string; revision: string }>(factory, "GET", path);
    expect(current.repo).toBe("usuario/segundo");
    expect(current.revision).not.toBe(preview.revision);
    expect(factory.retroSink.issues).toHaveLength(0);
    // Só o adaptador fake recebe esta aprovação; nunca acessa o GitHub real.
    const reached = hold();
    const release = hold();
    const listOpen = factory.retroSink.listOpen.bind(factory.retroSink);
    factory.retroSink.listOpen = async (repo) => {
      reached.release();
      await release.promise;
      return listOpen(repo);
    };
    const publishing = api(factory, "POST", `${path}/approve`, { revision: current.revision });
    try {
      await reached.promise;
      expect(
        (
          await fetch(`${factory.url}/settings/retro`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ repo: "usuario/terceiro" }),
          })
        ).status,
      ).toBe(409);
    } finally {
      release.release();
      await publishing;
    }
    expect(factory.retroSink.issues).toHaveLength(1);
    expect(factory.retroSink.issues[0]?.repo).toBe("usuario/segundo");
  });
});
