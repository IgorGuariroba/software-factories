// Seção "Agentes das etapas" da configuração de projeto: modelo, prompt adicional, ferramentas, skills e servidores MCP
// de cada etapa, além dos editores de skills e de servidores MCP do projeto. A API valida tudo (catálogo fechado, schema
// e referências); esta tela só monta o formulário e converte os valores.
import { etapasDoFormulario, servidoresMcpDoFormulario, skillsDoFormulario } from "./projeto-config.js";
import { rotuloEtapa } from "./trace.js";

const ETAPAS = ["spec", "review", "implementacao", "retro"];

/** Campo de texto com rótulo; `el` vem da tela de projeto. */
const campo = (el, rotulo, controle) => el("label", {}, [el("span", { texto: rotulo }), controle]);

/**
 * Desenha as etapas e os editores de skills e de servidores MCP em `caixa`. Devolve `{ lerEtapas, lerSkills,
 * lerServidores }`, que leem o formulário nos blocos `etapas`, `skills` e `mcpServers` da configuração. `catalogo` vem de
 * GET /ferramentas; cada etapa só oferece as ferramentas que ela tem (campo `etapas`).
 */
export function desenharEtapasAgente(caixa, atual, catalogo, el) {
  const skillsLinhas = [];
  const servidoresLinhas = [];
  const nomesDeSkills = () => skillsLinhas.map((l) => l.nome.value.trim()).filter(Boolean);
  const nomesDeServidores = () => servidoresLinhas.map((l) => l.nome.value.trim()).filter(Boolean);

  // ---- Skills do projeto ----
  const campoSkill = (skill = {}) => {
    const nome = el("input", { type: "text", "aria-label": "Nome da skill", valor: skill.nome ?? "" });
    const descricao = el("input", { type: "text", "aria-label": "Descrição da skill", valor: skill.descricao ?? "" });
    const conteudo = el("textarea", { "aria-label": "Conteúdo da skill", texto: skill.conteudo ?? "" });
    const linha = { nome, descricao, conteudo };
    skillsLinhas.push(linha);
    const bloco = el("fieldset", { classe: "skill-projeto" }, [
      el("legend", { texto: skill.nome ? `Skill ${skill.nome}` : "Nova skill" }),
      campo(el, "Nome", nome),
      campo(el, "Descrição", descricao),
      campo(el, "Conteúdo", conteudo),
      el("button", {
        type: "button",
        texto: "Remover skill",
        onclick: () => {
          skillsLinhas.splice(skillsLinhas.indexOf(linha), 1);
          bloco.remove();
        },
      }),
    ]);
    return bloco;
  };
  const skillsBox = el(
    "div",
    { classe: "skills-projeto" },
    (atual.skills ?? []).map((skill) => campoSkill(skill)),
  );

  // ---- Servidores MCP do projeto ----
  const campoServidor = (servidor = {}) => {
    const nome = el("input", { type: "text", "aria-label": "Nome do servidor MCP", valor: servidor.nome ?? "" });
    const comando = el("input", {
      type: "text",
      "aria-label": "Comando do servidor MCP",
      valor: servidor.comando ?? "",
    });
    const argumentos = el("textarea", {
      "aria-label": "Argumentos do servidor MCP, um por linha",
      texto: (servidor.argumentos ?? []).join("\n"),
    });
    const linha = { nome, comando, argumentos };
    servidoresLinhas.push(linha);
    const bloco = el("fieldset", { classe: "servidor-mcp" }, [
      el("legend", { texto: servidor.nome ? `Servidor ${servidor.nome}` : "Novo servidor MCP" }),
      campo(el, "Nome", nome),
      campo(el, "Comando", comando),
      campo(el, "Argumentos (um por linha)", argumentos),
      el("button", {
        type: "button",
        texto: "Remover servidor",
        onclick: () => {
          servidoresLinhas.splice(servidoresLinhas.indexOf(linha), 1);
          bloco.remove();
        },
      }),
    ]);
    return bloco;
  };
  const servidoresBox = el(
    "div",
    { classe: "servidores-mcp" },
    (atual.mcpServers ?? []).map((servidor) => campoServidor(servidor)),
  );

  // ---- Etapas ----
  const linhas = {};
  const blocos = ETAPAS.map((etapa) => {
    const rotulo = rotuloEtapa(etapa);
    const salvo = atual.etapas?.[etapa] ?? {};
    const disponiveis = catalogo.filter((f) => f.etapas.includes(etapa)).map((f) => f.nome);
    const padrao = catalogo.filter((f) => f.etapasPadrao.includes(etapa)).map((f) => f.nome);
    const provedor = el("input", {
      type: "text",
      "aria-label": `Provedor da etapa ${rotulo}`,
      valor: salvo.modelo?.provider ?? "",
    });
    const modelo = el("input", {
      type: "text",
      "aria-label": `Modelo da etapa ${rotulo}`,
      valor: salvo.modelo?.model ?? "",
    });
    const prompt = el("textarea", {
      "aria-label": `Prompt adicional da etapa ${rotulo}`,
      texto: salvo.promptAdicional ?? "",
    });
    const ativas = salvo.ferramentas ?? padrao;
    // Ferramentas que a etapa implementa; o bash (`executar_comando`) aparece só na implementação e tem aviso ao ligar.
    const ferramentas = disponiveis.map((nome) => {
      const aviso = el("p", {
        classe: "aviso-ferramenta",
        texto:
          "Comandos rodam no sandbox: sem rede e com o clone como único lugar gravável. Ainda assim, o comando pode " +
          "alterar o código do clone; revise a alteração antes do merge.",
      });
      const input = el("input", {
        type: "checkbox",
        marcado: ativas.includes(nome),
        "data-ferramenta": nome,
        onchange: () => (aviso.hidden = !input.checked),
      });
      aviso.hidden = !(nome === "executar_comando" && input.checked);
      return {
        nome,
        input,
        label: el("label", {}, [input, el("span", { texto: nome }), aviso]),
      };
    });
    const escolhidas = salvo.skills ?? [];
    const skills = (atual.skills ?? []).map((skill) => {
      const input = el("input", {
        type: "checkbox",
        marcado: escolhidas.includes(skill.nome),
        "data-skill": skill.nome,
      });
      return { nome: skill.nome, input, label: el("label", {}, [input, el("span", { texto: skill.nome })]) };
    });
    // Servidores MCP: a permissão é o que está marcado e as tools listadas; nada é liberado sem marcar.
    const mcpSalvo = salvo.mcp ?? [];
    const mcp = (atual.mcpServers ?? []).map((servidor) => {
      const salvoNoServidor = mcpSalvo.find((m) => m.servidor === servidor.nome);
      const usar = el("input", {
        type: "checkbox",
        marcado: salvoNoServidor !== undefined,
        "data-mcp": servidor.nome,
      });
      const tools = el("input", {
        type: "text",
        "aria-label": `Tools liberadas do servidor ${servidor.nome} na etapa ${rotulo}`,
        valor: (salvoNoServidor?.ferramentas ?? []).join(", "),
      });
      return { servidor: servidor.nome, usar, tools };
    });
    linhas[etapa] = { provedor, modelo, prompt, ferramentas, padrao, skills, mcp };
    return el("fieldset", { classe: "etapa-agente" }, [
      el("legend", { texto: rotulo }),
      campo(el, "Provedor", provedor),
      campo(el, "Modelo", modelo),
      campo(el, "Prompt adicional", prompt),
      el(
        "div",
        { classe: "ferramentas-etapa" },
        ferramentas.map((f) => f.label),
      ),
      el(
        "div",
        { classe: "skills-etapa" },
        skills.length > 0 ? skills.map((s) => s.label) : [el("p", { texto: "Nenhuma skill no projeto ainda." })],
      ),
      el(
        "div",
        { classe: "mcp-etapa" },
        mcp.length > 0
          ? mcp.flatMap((m) => [
              el("label", {}, [m.usar, el("span", { texto: `Usar servidor ${m.servidor}` })]),
              campo(el, `Tools liberadas de ${m.servidor}`, m.tools),
            ])
          : [el("p", { texto: "Nenhum servidor MCP no projeto ainda." })],
      ),
    ]);
  });

  caixa.replaceChildren(
    el("h3", { texto: "Agentes das etapas" }),
    el("p", { texto: "Cada etapa roda como agente próprio. Deixe o modelo em branco para usar o papel padrão." }),
    ...blocos,
    el("h3", { texto: "Skills do projeto" }),
    el("p", { texto: "Blocos de instruções que cada etapa pode ativar. Uma skill desligada não entra no prompt." }),
    skillsBox,
    el("button", {
      type: "button",
      texto: "Adicionar skill",
      onclick: () => skillsBox.append(campoSkill()),
    }),
    el("h3", { texto: "Servidores MCP do projeto" }),
    el("p", { texto: "Servidores iniciados por comando local (stdio). Uma etapa só usa as tools que você liberar." }),
    servidoresBox,
    el("button", {
      type: "button",
      texto: "Adicionar servidor MCP",
      onclick: () => servidoresBox.append(campoServidor()),
    }),
  );

  const lerEtapas = () => {
    const nomesSkills = nomesDeSkills();
    const nomesServidores = nomesDeServidores();
    return etapasDoFormulario(
      Object.fromEntries(
        ETAPAS.map((etapa) => [
          etapa,
          {
            modelo: { provider: linhas[etapa].provedor.value, model: linhas[etapa].modelo.value },
            promptAdicional: linhas[etapa].prompt.value,
            ferramentas: linhas[etapa].ferramentas.filter((f) => f.input.checked).map((f) => f.nome),
            padrao: linhas[etapa].padrao,
            // Só o que ainda existe no editor do projeto: uma skill ou servidor removido some da etapa.
            skills: linhas[etapa].skills
              .filter((s) => s.input.checked && nomesSkills.includes(s.nome))
              .map((s) => s.nome),
            mcp: linhas[etapa].mcp
              .filter((m) => m.usar.checked && nomesServidores.includes(m.servidor))
              .map((m) => ({
                servidor: m.servidor,
                ferramentas: m.tools.value
                  .split(",")
                  .map((t) => t.trim())
                  .filter((t) => t !== ""),
              })),
          },
        ]),
      ),
    );
  };

  const lerSkills = () =>
    skillsDoFormulario(
      skillsLinhas.map((l) => ({ nome: l.nome.value, descricao: l.descricao.value, conteudo: l.conteudo.value })),
    );

  const lerServidores = () =>
    servidoresMcpDoFormulario(
      servidoresLinhas.map((l) => ({ nome: l.nome.value, comando: l.comando.value, argumentos: l.argumentos.value })),
    );

  return { lerEtapas, lerSkills, lerServidores };
}
