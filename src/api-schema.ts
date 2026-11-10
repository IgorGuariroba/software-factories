import { RETRO_REPO_PATTERN } from "./retro-settings.js";

/** Schema OpenAPI da API local da fábrica, servido em `GET /openapi.json`. */
const taskPath = (summary: string) => ({
  post: {
    summary,
    parameters: [
      { name: "project", in: "path", required: true, schema: { type: "string" } },
      { name: "key", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: { "200": { description: "Tarefa atualizada" }, "404": { description: "Tarefa inexistente" } },
  },
});

const ok = { "200": { description: "OK" } };

export const API_SCHEMA = {
  openapi: "3.1.0",
  info: { title: "Fábrica de Software: API local", version: "1" },
  servers: [{ url: "http://127.0.0.1:7420" }],
  // Toda rota responde 403 a Host não local e a POST com Origin de outro site.
  paths: {
    "/queue": {
      get: { summary: "Cards elegíveis na Fonte (A Fazer e Em Andamento atribuídos ao usuário)", responses: ok },
    },
    "/poll": {
      post: {
        summary: "Busca agora na Fonte e enfileira os cards elegíveis (A Fazer e Em Andamento) novos",
        responses: ok,
      },
    },
    "/tasks": {
      get: {
        summary: "Tarefas na ordem da fila, com status",
        responses: {
          "200": {
            description: "Tarefas",
            content: {
              "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Task" } } },
            },
          },
        },
      },
    },
    "/tasks/order": {
      post: {
        summary: "Reordena a fila: os ids enviados vão para a frente, nessa ordem",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["ids"],
                properties: { ids: { type: "array", items: { type: "string" } } },
              },
            },
          },
        },
        responses: {
          ...ok,
          "400": { description: "Corpo sem { ids: string[] }" },
          "415": { description: "Content-Type diferente de application/json" },
        },
      },
    },
    "/tasks/{project}/{key}/spec": {
      get: {
        summary: "Prévia exata dos comentários SPEC e Tickets aguardando aprovação",
        parameters: [
          { name: "project", in: "path", required: true, schema: { type: "string" } },
          { name: "key", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Prévia vinculada à revisão",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["card", "spec", "tickets", "dryRun", "revision"],
                  properties: {
                    card: { type: "string" },
                    spec: { type: "string" },
                    tickets: { type: "string" },
                    dryRun: { type: "boolean" },
                    revision: { type: "string" },
                  },
                },
              },
            },
          },
          "404": { description: "SPEC inexistente" },
          "409": { description: "SPEC indisponível para aprovação" },
        },
      },
    },
    "/tasks/{project}/{key}/triage": {
      get: {
        summary: "Prévia exata da triagem aguardando decisão: motivo, comentário e fechamento se recusada",
        parameters: [
          { name: "project", in: "path", required: true, schema: { type: "string" } },
          { name: "key", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Prévia vinculada à revisão",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["card", "verdict", "category", "reason", "comment", "closeAs", "dryRun", "revision"],
                  properties: {
                    card: { type: "string" },
                    verdict: { enum: ["recusa", "duvidosa"] },
                    category: { type: "string" },
                    reason: { type: "string" },
                    by: { enum: ["regra", "modelo"] },
                    duplicateOf: { type: ["string", "null"] },
                    comment: { type: "string" },
                    closeAs: { enum: ["completed", "not_planned", "duplicate"] },
                    dryRun: { type: "boolean" },
                    revision: { type: "string" },
                  },
                },
              },
            },
          },
          "404": { description: "Triagem inexistente" },
          "409": { description: "Triagem não aguarda decisão" },
        },
      },
    },
    "/tasks/{project}/{key}/triage/decide": {
      post: {
        summary: "Decide a triagem da revisão exata: aceitar segue para a SPEC; recusar comenta e fecha a issue",
        parameters: [
          { name: "project", in: "path", required: true, schema: { type: "string" } },
          { name: "key", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["decision", "revision"],
                properties: { decision: { enum: ["aceitar", "recusar"] }, revision: { type: "string" } },
              },
            },
          },
        },
        responses: {
          ...ok,
          "400": { description: "Decisão inválida" },
          "409": { description: "Prévia mudou, indisponível ou recusa em dry-run" },
          "415": { description: "Content-Type inválido" },
        },
      },
    },
    "/tasks/{project}/{key}/spec/approve": {
      post: {
        summary: "Aprova localmente a revisão exata no modo atual; dry-run só registra SPEC e Tickets ao continuar",
        parameters: [
          { name: "project", in: "path", required: true, schema: { type: "string" } },
          { name: "key", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["revision"], properties: { revision: { type: "string" } } },
            },
          },
        },
        responses: {
          ...ok,
          "409": { description: "Prévia mudou ou SPEC indisponível para aprovação" },
          "415": { description: "Content-Type inválido" },
        },
      },
    },
    "/tasks/{project}/{key}/questions/{n}/reminder": {
      get: {
        summary: "Prévia exata do lembrete ao PO aguardando aprovação",
        parameters: [
          { name: "project", in: "path", required: true, schema: { type: "string" } },
          { name: "key", in: "path", required: true, schema: { type: "string" } },
          { name: "n", in: "path", required: true, schema: { type: "integer" } },
        ],
        responses: {
          "200": {
            description: "Prévia vinculada à revisão",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["card", "to", "comment", "dryRun", "revision"],
                  properties: {
                    card: { type: "string" },
                    to: { type: "string" },
                    comment: { type: "string" },
                    dryRun: { type: "boolean" },
                    revision: { type: "string" },
                  },
                },
              },
            },
          },
          "404": { description: "Pergunta inexistente" },
          "409": { description: "Lembrete indisponível" },
        },
      },
    },
    "/tasks/{project}/{key}/questions/{n}/reminder/approve": {
      post: {
        summary: "Aprova a revisão exata e publica o lembrete no card",
        parameters: [
          { name: "project", in: "path", required: true, schema: { type: "string" } },
          { name: "key", in: "path", required: true, schema: { type: "string" } },
          { name: "n", in: "path", required: true, schema: { type: "integer" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["revision"], properties: { revision: { type: "string" } } },
            },
          },
        },
        responses: {
          ...ok,
          "404": { description: "Pergunta inexistente" },
          "409": { description: "Prévia mudou, indisponível ou dry-run" },
          "415": { description: "Content-Type inválido" },
        },
      },
    },
    "/tasks/{project}/{key}/questions/{n}/answer": {
      post: {
        summary:
          "Registra resposta local: não sei sinaliza encaminhamento ao tech lead; " +
          "resposta resolutiva acorda a Tarefa. Não publica a resposta na Fonte.",
        parameters: [
          { name: "project", in: "path", required: true, schema: { type: "string" } },
          { name: "key", in: "path", required: true, schema: { type: "string" } },
          { name: "n", in: "path", required: true, schema: { type: "integer", minimum: 1 } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["answer"],
                properties: {
                  answer: { type: "string", minLength: 1, maxLength: 20000 },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Resposta registrada e classificada pela mesma operação usada pelo Telegram" },
          "400": { description: "Resposta vazia, inválida ou acima de 20000 caracteres" },
          "404": { description: "Pergunta inexistente" },
          "409": { description: "Pergunta indisponível ou resposta não resolve a decisão de repositório" },
          "415": { description: "Content-Type diferente de application/json" },
        },
      },
    },
    "/tasks/{project}/{key}/questions/{n}": {
      get: {
        summary: "Prévia exata da pergunta e do aviso ao PO",
        parameters: [
          { name: "project", in: "path", required: true, schema: { type: "string" } },
          { name: "key", in: "path", required: true, schema: { type: "string" } },
          { name: "n", in: "path", required: true, schema: { type: "integer" } },
        ],
        responses: {
          "200": {
            description: "Prévia vinculada à revisão",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["card", "to", "comment", "teamsUserId", "teamsMessage", "dryRun", "revision"],
                  properties: {
                    card: { type: "string" },
                    to: { type: "string" },
                    comment: { type: "string" },
                    teamsUserId: { type: ["string", "null"] },
                    teamsMessage: { type: ["string", "null"] },
                    dryRun: { type: "boolean" },
                    revision: { type: "string" },
                  },
                },
              },
            },
          },
          "404": { description: "Pergunta inexistente" },
          "409": { description: "Pergunta indisponível" },
        },
      },
    },
    "/tasks/{project}/{key}/questions/{n}/approve": {
      post: {
        summary: "Aprova a revisão exata e envia a pergunta e o aviso",
        parameters: [
          { name: "project", in: "path", required: true, schema: { type: "string" } },
          { name: "key", in: "path", required: true, schema: { type: "string" } },
          { name: "n", in: "path", required: true, schema: { type: "integer" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["revision"], properties: { revision: { type: "string" } } },
            },
          },
        },
        responses: {
          ...ok,
          "404": { description: "Pergunta inexistente" },
          "409": { description: "Prévia mudou, indisponível ou dry-run" },
          "415": { description: "Content-Type inválido" },
        },
      },
    },
    "/tasks/{project}/{key}/retros/{stage}/{n}": {
      get: {
        summary: "Prévia do conteúdo público de uma proposta pendente",
        parameters: [
          { name: "project", in: "path", required: true, schema: { type: "string" } },
          { name: "key", in: "path", required: true, schema: { type: "string" } },
          {
            name: "stage",
            in: "path",
            required: true,
            schema: { enum: ["triagem", "spec", "implementacao", "review", "mr", "tarefa"] },
          },
          { name: "n", in: "path", required: true, schema: { type: "integer" } },
        ],
        responses: {
          "200": {
            description: "Prévia do texto público e revisão a ser aprovada",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["title", "body", "repo", "dryRun", "blocked", "revision"],
                  properties: {
                    title: { type: "string" },
                    body: { type: "string" },
                    repo: { type: "string" },
                    dryRun: { type: "boolean" },
                    blocked: { type: "boolean" },
                    revision: { type: "string" },
                  },
                },
              },
            },
          },
          "404": { description: "Proposta inexistente" },
          "409": { description: "Proposta indisponível ou sem repositório" },
        },
      },
    },
    "/tasks/{project}/{key}/retros/{stage}/{n}/approve": {
      post: {
        summary: "Aprova a revisão exata e publica ou registra +1 no repositório público",
        parameters: [
          { name: "project", in: "path", required: true, schema: { type: "string" } },
          { name: "key", in: "path", required: true, schema: { type: "string" } },
          {
            name: "stage",
            in: "path",
            required: true,
            schema: { enum: ["triagem", "spec", "implementacao", "review", "mr", "tarefa"] },
          },
          { name: "n", in: "path", required: true, schema: { type: "integer" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["revision"], properties: { revision: { type: "string" } } },
            },
          },
        },
        responses: {
          ...ok,
          "404": { description: "Proposta inexistente" },
          "409": { description: "Prévia mudou, publicação bloqueada ou já processada" },
          "415": { description: "Content-Type inválido" },
        },
      },
    },
    "/tasks/{project}/{key}": {
      get: {
        summary:
          "Detalhe da tarefa: estado, etapa, perguntas ao PO, SPEC e Tickets entregues, progresso da implementação, " +
          "retrôs com as propostas classificadas, " +
          "histórico de eventos dela e escritas registradas (feitas, do dry-run ou barradas por guardrail)",
        parameters: taskPath("").post.parameters,
        responses: {
          "200": {
            description: "Detalhe da tarefa",
            content: { "application/json": { schema: { $ref: "#/components/schemas/TaskDetail" } } },
          },
          "404": { description: "Tarefa inexistente" },
        },
      },
    },
    "/tasks/{project}/{key}/pause": taskPath("Pausa a tarefa (a ativa para no próximo passo)"),
    "/tasks/{project}/{key}/resume": taskPath(
      "Retoma tarefa pausada ou revalida baseline bloqueado antes do primeiro commit",
    ),
    "/tasks/{project}/{key}/repair": {
      get: {
        summary: "Prévia exata dos reparos locais de tarefa bloqueada por TDD",
        parameters: taskPath("").post.parameters,
        responses: ok,
      },
      post: {
        summary: "Aprova reparos humanos por revisão, valida a suíte e integra o checkpoint sem retomar ou publicar",
        parameters: taskPath("").post.parameters,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["revision", "approveTestChanges"],
                properties: {
                  revision: { type: "string", pattern: "^[0-9a-f]{64}$" },
                  approveTestChanges: { type: "boolean", enum: [true] },
                },
              },
            },
          },
        },
        responses: ok,
      },
    },
    "/tasks/{project}/{key}/cancel": taskPath("Cancela a tarefa"),
    "/tasks/{project}/{key}/veto": {
      post: {
        summary:
          "Veta a tarefa de um card que já estava em andamento, dentro do prazo de veto: ela fica vetada e não age mais no card",
        parameters: taskPath("").post.parameters,
        responses: {
          "200": { description: "Tarefa vetada" },
          "404": { description: "Tarefa inexistente" },
          "409": {
            description: "A tarefa não está aguardando veto (o prazo já passou ou ela não passa por veto); sem efeito",
          },
        },
      },
    },
    "/settings/retro": {
      get: { summary: "Repositório público das retrôs e disponibilidade do adaptador", responses: ok },
      post: {
        summary: "Salva e aplica o repositório público global, sem publicar ou reiniciar",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["repo"],
                properties: { repo: { type: "string", maxLength: 200, pattern: RETRO_REPO_PATTERN } },
              },
            },
          },
        },
        responses: {
          ...ok,
          "400": { description: "Repositório inválido; use dono/nome" },
          "409": { description: "Adaptador indisponível ou publicação/configuração em andamento" },
          "415": { description: "Content-Type deve ser application/json" },
        },
      },
    },
    "/repos": {
      get: { summary: "Repositórios monitorados e o vínculo de cada um (ativo ou desativado)", responses: ok },
    },
    "/github-app": {
      get: {
        summary:
          "Painel do GitHub App (só leitura): receptor do webhook, instalações do App e cobertura de cada repositório plugado",
        responses: ok,
      },
    },
    "/github/repos": {
      get: {
        summary:
          "Catálogo dos repositórios que o GitHub App acessa (só leitura), com id, privacidade, instalação e o plugue atual de cada um",
        responses: ok,
      },
    },
    "/projetos/github": {
      post: {
        summary:
          "Cria um projeto a partir de um repositório do catálogo do GitHub App (corpo: { repoId, nome, fonte: { type: github|gitlab|jira, project, ...campos da Fonte }, comandoTeste: string[], horario?: business-hours|always, ensaio? }). A fábrica clona o repositório em diretório gerenciado; o projeto nasce incompleto se faltar PO, tech lead ou outro item (ADR-0022). Responde 201 com estado e pendencias; 502 se a clonagem falhar, sem gravar nada",
        responses: ok,
      },
    },
    "/projetos/gitlab": {
      post: {
        summary:
          "Cria um projeto a partir de um repositório GitLab por caminho completo (corpo: { nome, caminho: grupo/projeto, servidor?: URL https (vazio para gitlab.com), fonte: { project, assignee, credential, ignoreLabels? }, comandoTeste: string[], horario?, ensaio? }). O token do cofre é conferido no caminho antes de salvar; a fábrica clona o repositório em diretório gerenciado. Responde 201 com estado e pendencias; 400 se o caminho ou o token não servirem, sem gravar nada",
        responses: ok,
      },
    },
    "/github/importar": {
      post: {
        summary:
          "Importa as issues abertas (sem PRs) de um repositório do App para a fábrica, na fila (corpo: { repoId }). Responde 202 com o registro; repetir não duplica",
        responses: ok,
      },
    },
    "/repos/plugar": {
      post: { summary: "Reativa o repositório de um projeto já configurado (corpo: { repo })", responses: ok },
    },
    "/repos/desplugar": {
      post: {
        summary:
          "Desativa o repositório: cancela as Tarefas não iniciadas (corpo: { repo, force? }); Tarefa em execução exige force",
        responses: ok,
      },
    },
    "/projetos": { get: { summary: "Projetos carregados, com a Fonte e o estado do ensaio", responses: ok } },
    "/projetos/{nome}/configuracao": {
      get: { summary: "Configuração guardada do projeto (ADR-0017)", responses: ok },
      put: {
        summary:
          "Grava a configuração do projeto, validada pelo schema, pelos perfis, pelos caminhos de repositório e pela conexão da Fonte Jira com credencial; aplica na hora",
        responses: ok,
      },
    },
    "/projetos/{nome}/historico": {
      get: { summary: "Histórico de alterações da configuração, sem valores", responses: ok },
    },
    "/projetos/{nome}/pendencias": { get: { summary: "O que falta na configuração (lista de avisos)", responses: ok } },
    "/projetos/{nome}/estado": {
      get: { summary: "Estado do projeto (incompleto ou ativo) com a lista do que falta (ADR-0022)", responses: ok },
    },
    "/segredos": { get: { summary: "Credenciais cadastradas: nome e data, nunca o valor", responses: ok } },
    "/ferramentas": {
      get: {
        summary:
          "Catálogo fechado de ferramentas: nome, tipo, etapas que as implementam e etapas que as têm ligadas por padrão",
        responses: ok,
      },
    },
    "/tasks/{project}/{key}/etapas/{etapa}/memoria/esquecer": {
      post: {
        summary: "Esquece a memória da SPEC: a próxima execução usa uma conversa nova; o histórico fica guardado",
        responses: ok,
      },
    },
    "/tasks/{project}/{key}/etapas/{etapa}/mensagem": {
      post: {
        summary:
          "Mensagem do usuário para o Agente da etapa: vira steer se a etapa roda, ou inicia um turno se está parada",
        responses: ok,
      },
    },
    "/tasks/{project}/{key}/trace": {
      get: {
        summary:
          "Trace de cada etapa da Tarefa: passos da conversa (pedido, texto, chamadas e resultados de ferramenta)",
        responses: ok,
      },
    },
    "/segredos/{nome}": {
      put: { summary: "Grava uma credencial no cofre (o valor não volta depois)", responses: ok },
    },
    "/telegram/configuracao": {
      get: { summary: "Chat e credencial do bot do Telegram do usuário (sem token)", responses: ok },
      put: { summary: "Grava chat e credencial do bot, validando a credencial no cofre", responses: ok },
    },
    "/integracoes/fontes": { get: { summary: "Fontes disponíveis e os campos do schema de cada uma", responses: ok } },
    "/integracoes/canais": {
      get: { summary: "Tipos de Canal registrados: conversa (perguntas e respostas) e aviso", responses: ok },
    },
    "/perfis/modelos": { get: { summary: "Modelos prontos de perfil (PO e Tech Lead)", responses: ok } },
    "/daemon": { get: { summary: "Estado do daemon ({ paused })", responses: ok } },
    "/daemon/pause": { post: { summary: "Pausa o daemon: nenhuma tarefa nova começa", responses: ok } },
    "/daemon/resume": { post: { summary: "Retoma o daemon", responses: ok } },
    "/events": {
      get: {
        summary:
          "Histórico de eventos (escritas, bloqueios, erros, status de tarefas, assunções, perguntas, avisos ao usuário do " +
          "tipo notify (inclusive sugestões da retrô para o repo do time), retrôs concluídas ou que desistiram, comandos recebidos pelas interfaces de gestão e mensagens descartadas)",
        responses: ok,
      },
    },
    "/events/stream": { get: { summary: "Eventos novos em tempo real (Server-Sent Events)", responses: ok } },
    "/openapi.json": { get: { summary: "Este schema", responses: ok } },
  },
  components: {
    schemas: {
      Task: {
        type: "object",
        properties: {
          id: { type: "string", description: "<projeto>/<card>" },
          ref: {
            type: ["string", "null"],
            description:
              "Id opaco e estável da tarefa: a única referência a ela nas issues públicas da fábrica " +
              "(sem URL; colado na página local como #/retro/<ref>, abre a tarefa)",
          },
          project: { type: "string" },
          key: { type: "string" },
          title: { type: "string" },
          status: {
            enum: [
              "enfileirada",
              "ativa",
              "aguardando-humano",
              "aguardando-veto",
              "pausada",
              "concluida",
              "cancelada",
              "bloqueada",
              "vetada",
              "recusada",
              "aguardando-entrega",
            ],
          },
          stage: {
            description: "Etapa atual (ou a última em que esteve); null se ainda não começou",
            enum: ["triagem", "assumir", "veto", "spec", "implementacao", "review", "entrega", null],
          },
          resumeAllowed: {
            type: "boolean",
            description: "Retomada disponível conforme o mesmo guardrail do comando; herdado pelo detalhe",
          },
          attempts: { type: "integer" },
          reason: { type: ["string", "null"] },
          specReview: { enum: ["draft", "approved", null], description: "Revisão da SPEC antes de publicar" },
          triageReview: { enum: ["draft", "aceitar", "recusar", null], description: "Revisão humana da triagem" },
          pendingQuestion: { type: ["integer", "null"], description: "Número da pergunta ainda sem resposta" },
        },
      },
      Retro: {
        type: "object",
        properties: {
          stage: {
            enum: ["triagem", "spec", "implementacao", "review", "mr", "tarefa"],
            description: "tarefa: a retrô consolidada",
          },
          status: {
            enum: ["em-andamento", "concluida", "falhou"],
            description: "falhou: desistiu depois das tentativas, sem bloquear a tarefa",
          },
          attempts: { type: "integer", description: "Tentativas que falharam" },
          error: { type: ["string", "null"] },
          summary: { type: ["string", "null"] },
          proposals: {
            type: "array",
            items: {
              type: "object",
              properties: {
                n: { type: "integer" },
                kind: { enum: ["fabrica", "conhecimento", "repo-time"] },
                title: { type: "string" },
                description: { type: "string" },
                status: {
                  enum: [
                    "a-publicar",
                    "issue-criada",
                    "mais-um",
                    "ja-registrada",
                    "dry-run",
                    "sem-repo",
                    "bloqueada",
                    "pendente",
                    "avisada",
                  ],
                },
                issue: {
                  type: ["object", "null"],
                  description: "Issue retro aberta ou comentada no repositório da fábrica",
                  properties: { number: { type: "integer" }, url: { type: "string" } },
                },
                reason: { type: ["string", "null"], description: "Por que o guardrail barrou a escrita" },
              },
            },
          },
        },
      },
      TaskDetail: {
        allOf: [
          { $ref: "#/components/schemas/Task" },
          {
            type: "object",
            properties: {
              pauseRequested: { type: "boolean" },
              vetoUntil: { type: ["string", "null"], description: "Fim do prazo de veto (ISO 8601), se aguarda veto" },
              questions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    n: { type: "integer" },
                    to: { type: "string" },
                    text: { type: "string" },
                    askedAt: { type: "string" },
                    answer: { type: ["string", "null"], description: "null enquanto pendente" },
                    origin: {
                      type: "string",
                      enum: ["grill", "card-raso", "tecnica"],
                      description: "Origem da pergunta: negócio, card raso ou dúvida técnica",
                    },
                    userResponse: {
                      type: ["string", "null"],
                      description: "Resposta não resolutiva preservada para encaminhamento, como não sei",
                    },
                    needsForwarding: {
                      type: "boolean",
                      description: "Indica que a pergunta ainda precisa ser encaminhada ao tech lead",
                    },
                    reminder: {
                      enum: ["draft", "sending", "sent", null],
                      description: "Lembrete em revisão; sending indica resultado incerto",
                    },
                    publication: {
                      enum: ["draft", "sending", "sent"],
                      description: "Situação da publicação da pergunta",
                    },
                    teamsNotice: {
                      enum: ["pending", "attempted", "sent", "uncertain", null],
                      description: "Situação do aviso Teams; attempted ou uncertain requerem verificação manual",
                    },
                  },
                },
              },
              spec: { type: ["string", "null"] },
              specReview: { enum: ["draft", "approved", null], description: "Revisão da SPEC antes de publicar" },
              triage: {
                description: "Triagem da issue (repositório monitorado); null nos outros projetos",
                type: ["object", "null"],
                properties: {
                  verdict: { enum: ["aceita", "recusa", "duvidosa"] },
                  reason: { type: "string" },
                  review: { enum: ["draft", "aceitar", "recusar", null] },
                },
              },
              tickets: {
                type: "array",
                description:
                  "Tickets originais aprovados, seguidos dos tickets de correção de review, na ordem durável",
                items: { type: "object", properties: { titulo: { type: "string" }, aceite: { type: "string" } } },
              },
              implementation: {
                type: ["object", "null"],
                properties: {
                  branch: { type: "string" },
                  branchOrigin: {
                    type: ["string", "null"],
                    enum: ["criada", "adotada", null],
                    description: "criada pela fábrica (aceita force-push) ou adotada do remoto (só push normal)",
                  },
                  commits: { type: "array", items: { type: "object" } },
                  synchronization: {
                    type: ["object", "null"],
                    description:
                      "Integração da base na branch da fábrica, com recibo, HEAD e diagnóstico; exige novo review antes de publicar",
                  },
                  verifiedTickets: {
                    type: "array",
                    description:
                      "Correções já atendidas, comprovadas por suíte GREEN no HEAD limpo e review independente; não são commits TDD",
                    items: {
                      type: "object",
                      properties: {
                        ticket: { type: "integer" },
                        sha: { type: "string" },
                        diagnostic: { type: "string" },
                      },
                    },
                  },
                  pushed: { type: "boolean" },
                },
              },
              review: { type: ["object", "null"], description: "Review independente do HEAD antes da publicação" },
              publication: { type: ["object", "null"], description: "PR/MR acompanhado até merge humano" },
              retros: {
                type: "array",
                description: "Retrôs das etapas de modelo (spec, implementacao) e a consolidada (tarefa), na ordem",
                items: { $ref: "#/components/schemas/Retro" },
              },
              events: { type: "array", description: "Eventos desta tarefa, em ordem", items: { type: "object" } },
              writes: {
                type: "array",
                description: "Eventos write (com dryRun) e blocked (com o motivo) desta tarefa",
                items: { type: "object" },
              },
            },
          },
        ],
      },
    },
  },
} as const;
