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
    "/poll": { post: { summary: "Busca agora na Fonte e enfileira os cards 'A Fazer' novos", responses: ok } },
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
    "/tasks/{project}/{key}/pause": taskPath("Pausa a tarefa (a ativa para no próximo passo)"),
    "/tasks/{project}/{key}/resume": taskPath("Retoma a tarefa pausada"),
    "/tasks/{project}/{key}/cancel": taskPath("Cancela a tarefa"),
    "/daemon": { get: { summary: "Estado do daemon ({ paused })", responses: ok } },
    "/daemon/pause": { post: { summary: "Pausa o daemon: nenhuma tarefa nova começa", responses: ok } },
    "/daemon/resume": { post: { summary: "Retoma o daemon", responses: ok } },
    "/events": {
      get: {
        summary:
          "Histórico de eventos (escritas, bloqueios, erros, status de tarefas, perguntas e avisos ao usuário do tipo notify)",
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
          project: { type: "string" },
          key: { type: "string" },
          title: { type: "string" },
          status: {
            enum: ["enfileirada", "ativa", "aguardando-humano", "pausada", "concluida", "cancelada", "bloqueada"],
          },
          attempts: { type: "integer" },
          reason: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;
