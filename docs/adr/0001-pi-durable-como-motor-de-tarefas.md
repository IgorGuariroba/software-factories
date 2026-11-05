# pi-durable como motor de tarefas

Cada tarefa da fábrica dura dias: ela espera humanos, cota e builds, e precisa sobreviver a reinícios do notebook. Por isso usamos o `@earendil-works/pi-durable` (tarefas com fases, `sleepUntil` persistido em SQLite, child tasks e `onReport`) em vez de um orquestrador próprio ou de uma fila externa. As etapas do pipeline são modeladas como fases e child tasks dele, o que cria acoplamento forte com a biblioteca.
