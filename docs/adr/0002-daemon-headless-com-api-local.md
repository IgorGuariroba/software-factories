# Daemon headless com API local; interfaces e canais são clientes

O núcleo da fábrica é um daemon sem UI que expõe uma API HTTP local e um stream de eventos (SSE/WS) com schema publicado. Todas as interfaces de gestão (web local, Telegram) e os canais de conversa (Teams, Jira etc.) são adaptadores sobre essa API, e um mesmo adaptador pode implementar os dois papéis. A TUI foi descartada: a web local servida pelo próprio daemon cobre o notebook e o Telegram cobre o celular.

## Consequences

- O M1 já entrega uma web mínima (fila, detalhe da tarefa, perguntas, diffs, propostas de retrô; ações de vetar, responder, aprovar e pausar) e o Telegram.

## Nota

As interfaces de gestão que rodam no mesmo processo do daemon (o Telegram, no M1) não falam HTTP com a API: chamam diretamente as mesmas operações que ela expõe (`RunningFactory.commands`) e assinam o mesmo log de eventos. O contrato continua um só; muda só o transporte. As mensagens delas vão ao canal particular do usuário e passam pelo filtro de segredos, fora do escritor de efeitos, que cuida das escritas em sistemas do time (Jira, git, issues públicas).
