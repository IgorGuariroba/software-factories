# pi-durable como motor de tarefas

> **Atualização (2026-11-11):** a biblioteca é experimental e muda sem aviso entre versões, então a dependência passa a ser fixada na versão exata. Não criamos uma porta para isolá-la: o acoplamento aceito aqui continua, e quem protege uma troca de versão é a suíte que roda a fábrica inteira pela API. As ADR-0023, 0026, 0031 e 0032 se apoiam no que ela já dá (commit atômico, intenção gravada antes de cada ferramenta, um único processo dono do banco).

Cada tarefa da fábrica dura dias: ela espera humanos, cota e builds, e precisa sobreviver a reinícios do notebook. Por isso usamos o `@earendil-works/pi-durable` (tarefas com fases, `sleepUntil` persistido em SQLite, child tasks e `onReport`) em vez de um orquestrador próprio ou de uma fila externa. As etapas do pipeline são modeladas como fases e child tasks dele, o que cria acoplamento forte com a biblioteca.
