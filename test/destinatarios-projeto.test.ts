import { describe, expect, it, vi } from "vitest";
import { criarNotificadorDoProjeto } from "../src/destinatarios-projeto.js";
import type { TeamsNotifier } from "../src/teams-mcp.js";

// O mesmo decorador TeamsNotifier protege os envios ao usuário e ao tech lead.
// A lista contém IDs de pessoas do projeto, não nomes, domínios ou prefixos.
function preparar() {
  const enviar = vi.fn<TeamsNotifier["send"]>().mockResolvedValue(undefined);
  const avisar = vi.fn<(aviso: string) => void>();
  const protegido = criarNotificadorDoProjeto({
    destinatariosPermitidos: ["8:orgid:usuario-projeto", "8:orgid:tech-lead-projeto"],
    notificador: { send: enviar },
    avisar,
  });
  return { protegido, enviar, avisar };
}

const papeis = [
  { papel: "usuário", permitido: "8:orgid:usuario-projeto" },
  { papel: "tech lead", permitido: "8:orgid:tech-lead-projeto" },
];

describe("guardrail de destinatários do projeto", () => {
  it.each(papeis)("permite enviar ao $papel que pertence ao projeto", async ({ permitido }) => {
    const { protegido, enviar, avisar } = preparar();
    const mensagem = { userId: permitido, text: "Qual regra devemos aplicar ao card PROJ-1?" };

    await protegido.send(mensagem);

    expect(enviar).toHaveBeenCalledExactlyOnceWith(mensagem);
    expect(avisar).not.toHaveBeenCalled();
  });

  it.each(papeis)("bloqueia a pergunta ao $papel externo antes de qualquer envio", async ({ papel }) => {
    const { protegido, enviar, avisar } = preparar();
    const userId = `8:orgid:${papel === "usuário" ? "usuario" : "tech-lead"}-externo`;
    const pergunta = "PERGUNTA CONFIDENCIAL: aprovar desconto de 37% para Cliente Sigiloso?";

    await expect(protegido.send({ userId, text: pergunta })).rejects.toThrow(/bloquead/i);

    // Nenhum efeito no transporte, nem mesmo um aviso ao destinatário proibido.
    expect(enviar).not.toHaveBeenCalled();
    expect(avisar).toHaveBeenCalledTimes(1);
    const aviso = avisar.mock.calls[0][0];
    expect(aviso).toMatch(/bloquead/i);
    expect(aviso).toMatch(/projeto/i);
    expect(aviso).toContain(userId);
    expect(aviso).not.toContain(pergunta);
    expect(aviso).not.toContain("Cliente Sigiloso");
  });

  it.each([
    "",
    "8:orgid:usuario-projeto-externo",
    "usuario-projeto",
    "8:orgid:tech-lead-projeto@outra-organizacao",
  ])("não aceita correspondência parcial ou destinatário vazio: %j", async (userId) => {
    const { protegido, enviar, avisar } = preparar();

    await expect(protegido.send({ userId, text: "Pergunta reservada" })).rejects.toThrow(/bloquead/i);

    expect(enviar).not.toHaveBeenCalled();
    expect(avisar).toHaveBeenCalledTimes(1);
  });

  it("lista vazia bloqueia por padrão, em vez de desativar a validação", async () => {
    const enviar = vi.fn<TeamsNotifier["send"]>().mockResolvedValue(undefined);
    const avisar = vi.fn<(aviso: string) => void>();
    const protegido = criarNotificadorDoProjeto({
      destinatariosPermitidos: [],
      notificador: { send: enviar },
      avisar,
    });

    await expect(protegido.send({ userId: "8:orgid:qualquer", text: "Pergunta" })).rejects.toThrow(/bloquead/i);

    expect(enviar).not.toHaveBeenCalled();
    expect(avisar).toHaveBeenCalledTimes(1);
  });

  it("revalida cada envio, sem reutilizar autorização do destinatário anterior", async () => {
    const { protegido, enviar, avisar } = preparar();
    const mensagemPermitida = { userId: "8:orgid:usuario-projeto", text: "Pergunta permitida" };
    await protegido.send(mensagemPermitida);

    await expect(protegido.send({ userId: "8:orgid:externo", text: "Pergunta secreta" })).rejects.toThrow(/bloquead/i);

    expect(enviar).toHaveBeenCalledExactlyOnceWith(mensagemPermitida);
    expect(avisar).toHaveBeenCalledTimes(1);
  });
});
