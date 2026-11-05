# A fábrica age com as credenciais do usuário, com prefixo visível

A fábrica opera no Jira, no GitLab, no Jenkins e no Teams com as credenciais do próprio usuário, e não com uma conta de serviço, porque o trabalho é atribuído a ele. Para não se passar por ele, toda mensagem ou comentário escrito pela fábrica leva um prefixo de automação visível (ex.: `🤖 [fábrica]`). Como o raio de ação é o do usuário, os guardrails (ADR-0006) são obrigatórios.
