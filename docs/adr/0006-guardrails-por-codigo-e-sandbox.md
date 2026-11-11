# Guardrails impostos por código e por sandbox, não por prompt

> **Complementada pela ADR-0023 (aceita, ainda não implementada):** a mesma jaula passa a cobrir também os testes do repositório, com raiz mínima e sem rede.

As proibições (merge; push em `main`/`master`/`develop`; force-push fora das branches da fábrica; jobs do Jenkins além do build de teste da branch; escrita em banco; mover o card além de `Aguardando Teste`; mexer em cards ou comentários alheios; mensagem para fora das pessoas do projeto) são verificadas pelos adaptadores antes de cada ação. Além disso, o bash dos modelos roda em `bubblewrap`, com rede limitada a GitLab, Jenkins, Jira e ao ambiente de teste. Instruções no prompt não bastam, porque a fábrica age com as credenciais do usuário (ADR-0003).
