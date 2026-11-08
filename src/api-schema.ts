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
        summary: "Aprova a revisão exata; a Tarefa publica SPEC e Tickets quando voltar a rodar",
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
          "409": { description: "Prévia mudou, indisponível ou dry-run" },
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
          { name: "stage", in: "path", required: true, schema: { enum: ["spec", "implementacao", "tarefa"] } },
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
          { name: "stage", in: "path", required: true, schema: { enum: ["spec", "implementacao", "tarefa"] } },
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
    "/tasks/{project}/{key}/resume": taskPath("Retoma a tarefa pausada"),
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
            ],
          },
          stage: {
            description: "Etapa atual (ou a última em que esteve); null se ainda não começou",
            enum: ["triagem", "assumir", "veto", "spec", "implementacao", null],
          },
          attempts: { type: "integer" },
          reason: { type: ["string", "null"] },
        },
      },
      Retro: {
        type: "object",
        properties: {
          stage: { enum: ["spec", "implementacao", "tarefa"], description: "tarefa: a retrô consolidada" },
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
                  pushed: { type: "boolean" },
                },
              },
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
