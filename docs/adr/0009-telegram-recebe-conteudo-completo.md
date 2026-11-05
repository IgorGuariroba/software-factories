# O Telegram recebe conteúdo completo, inclusive do projeto corporativo

O Telegram é um terceiro, mas é um canal particular do usuário e a interface de gestão do celular. Decidimos enviar por ele conteúdo completo (código, diffs, SPEC, perguntas técnicas) também no projeto corporativo, em vez de mensagens mínimas com link, porque só assim dá para operar a fábrica de fato pelo celular. A mitigação é um filtro de segredos, no estilo gitleaks, aplicado a toda mensagem de saída. O nível de conteúdo (`telegram.content`) continua configurável por projeto, para que possa ser endurecido depois.
