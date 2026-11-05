# Fábrica e molde

[← Índice](index.md)

A fábrica fabrica produtos a partir de **moldes**. Cada **projeto** (repositório) é o **molde do produto**: é nele que está o jeito específico de fabricar aquele produto, com as suas peculiaridades.

| | Fábrica | Molde (projeto) |
|---|---------|-----------------|
| **O que é** | O **equipamento**: tudo o que é usado para criar os produtos. | O jeito de fabricar um produto específico. |
| **O que contém** | Loops, triagem, regras, tools e ferramentas do agente, skills, MCPs e extensões de uso geral. | O agente pi do projeto: `AGENTS.md`, skills, rules, MCPs, extensões e hooks específicos do projeto, [memória de problemas conhecidos](06-memoria.md). |
| **Onde fica** | Repositório da fábrica (e dos componentes). | Repositório do projeto. |
| **Vale para** | Todos os projetos. | Só aquele produto. |

Uma skill, um MCP ou uma extensão pode ser de qualquer um dos dois lados:

- **Do molde**, quando resolve um ponto específico daquele projeto.
- **Da fábrica**, quando resolve um problema geral e passa a ser ferramental de todos os projetos.

Por isso existem **dois tipos de melhoria**, e é importante diferenciá-los:

- **Melhoria no molde**: problema focado, na construção de um produto específico. Melhora-se o molde, não a fábrica.
- **Melhoria na fábrica**: problema generalizado, no processo ou no equipamento, que afeta todos os produtos. A fábrica tem o seu próprio processo de melhoria.

Quem classifica a melhoria é um **modelo inteligente** no loop externo. A diferença entre molde e fábrica depende de julgamento e não dá para resolver com uma regra fixa.
