# O comentário que faz uma pergunta no card menciona a pessoa perguntada

O ADR-0012 já previa que a pergunta sai "como comentário no Jira, mencionando o PO". Uma versão posterior do escritor de efeitos passou a enviar o texto sem a menção, com a justificativa de que o acli grava texto puro. O usuário decidiu que o comentário deve trazer o identificador da pessoa, então a menção volta.

- **Quem é mencionado:** a pessoa do projeto para quem a pergunta foi feita, no formato que a própria Fonte define (`formatMention`): `[~accountid:<id>]` no Jira, `@login` no GitHub e no GitLab.
- **Onde:** no comeco do comentário, antes do texto, em toda pergunta e lembrete ao PO. A prévia de revisão mostra a mesma menção que será publicada.
- **O aviso no Teams continua à parte** e não substitui a menção no card.
- **Só pessoas do projeto** podem ser mencionadas: o guardrail de destinatário continua valendo.

## Considered Options

- Manter o comentário sem menção, como estava: rejeitado pelo usuário, porque o PO não é avisado pelo próprio card.
- Mencionar só pelo Teams: rejeitado, porque o card é onde a resposta é lida.

## Consequências

- No Jira, o comentário sai pela API REST em ADF. O texto `[~accountid:ID]` vira nó de menção (`mention`) no corpo, o que faz o Jira avisar a pessoa. Isso é verificado por simulação da API (o corpo enviado). A renderização num Jira real não foi verificada: exige um tenant de teste.
- Os testes de escritor e de perguntas passam a esperar a menção no texto.
- Ver também o [ADR-0012](0012-teams-graph-com-fallback-at-spi.md).
