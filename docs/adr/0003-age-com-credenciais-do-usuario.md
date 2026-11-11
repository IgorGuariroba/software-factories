# A fábrica age com as credenciais do usuário, com prefixo visível

> **Substituída em parte pela ADR-0027 (aceita, ainda não implementada):** no GitHub, a fábrica passa a escrever com o token de instalação do App, restrito ao repositório do projeto. No Jira, no GitLab e no Teams, esta decisão continua valendo. Até a implementação, o texto abaixo vale também para o GitHub.

A fábrica opera no Jira, no GitLab, no Jenkins e no Teams com as credenciais do próprio usuário, e não com uma conta de serviço, porque o trabalho é atribuído a ele. Para não se passar por ele, toda mensagem ou comentário escrito pela fábrica leva um prefixo de automação visível (ex.: `🤖 [mensagem automatizada]`). Como o raio de ação é o do usuário, os guardrails (ADR-0006) são obrigatórios.
