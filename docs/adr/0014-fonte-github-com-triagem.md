# Repositório GitHub como Fonte: toda issue aberta passa por triagem

O usuário conecta um repositório e a fábrica passa a monitorá-lo. Diferente do Jira, onde só os cards atribuídos ao usuário entram, aqui **toda issue aberta** é candidata, inclusive as antigas. Como a maioria dos repositórios é pública, qualquer pessoa pode abrir uma issue: o texto dela é dado não confiável, nunca instrução.

- **Fonte GitHub** (`source.type: github`), via `gh`: cada issue aberta vira um card `<project>-<número>` atribuído ao dono configurado; pull requests ficam de fora. O status vem de um label `fabrica:<status>` (sem label, `aberta`; fechada, `fechada`); transicionar troca o label, e `fechada` fecha a issue. Não há anexos. Comentários são escritos em Markdown.
- **Triagem** antes da SPEC: checagens determinísticas (já feito, PR ou branch existente, duplicata exata, sinais de abuso) e avaliação pelo modelo (segurança e prompt injection, duplicata semântica, já resolvido no código, escopo e clareza), com saída `aceita | recusa | duvidosa`.
  - `aceita` segue direto para a SPEC (que já tem prévia).
  - `recusa` dá baixa: comentário curto sem expor a regra de segurança, label e fechamento como *not planned* ou *duplicate*. No começo, toda baixa passa por prévia (`triageApproval`) até o usuário confiar.
  - `duvidosa` e risco alto vão ao usuário.
- **Uma issue em andamento por repositório** no começo (`maxActive: 1`), para não tocar todas ao mesmo tempo.
- Merge continua humano; a fábrica nunca dá push na branch padrão; o teste roda num container sem segredos.
