# Daemon headless com API local; interfaces e canais são clientes

O núcleo da fábrica é um daemon sem UI que expõe uma API HTTP local e um stream de eventos (SSE/WS) com schema publicado. Todas as interfaces de gestão (web local, Telegram) e os canais de conversa (Teams, Jira etc.) são adaptadores sobre essa API, e um mesmo adaptador pode implementar os dois papéis. A TUI foi descartada: a web local servida pelo próprio daemon cobre o notebook e o Telegram cobre o celular.

## Consequences

- O M1 já entrega uma web mínima (fila, detalhe da tarefa, perguntas, diffs, propostas de retrô; ações de vetar, responder, aprovar e pausar) e o Telegram.
