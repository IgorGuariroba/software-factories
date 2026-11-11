# Repositório GitHub como Fonte: toda issue aberta passa por triagem

> **Complementada pelas ADR-0023 e ADR-0024 (aceitas, ainda não implementadas):** os testes passam a rodar na jaula, e a prévia da baixa (`triageApproval`) vira uma linha da política de ações.

O usuário conecta um repositório e a fábrica passa a monitorá-lo. Diferente do Jira, onde só os cards atribuídos ao usuário entram, aqui **toda issue aberta** é candidata, inclusive as antigas. Como a maioria dos repositórios é pública, qualquer pessoa pode abrir uma issue: o texto dela é dado não confiável, nunca instrução.

- **Fonte GitHub** (`source.type: github`), via `gh`: cada issue aberta vira um card `<project>-<número>` atribuído ao dono configurado; pull requests ficam de fora. O status vem de um label `fabrica:<status>` (sem label, `aberta`; fechada, `fechada`); transicionar troca o label, e `fechada` fecha a issue. Não há anexos. Comentários são escritos em Markdown.
- **Triagem** antes da SPEC: checagens determinísticas (já feito, PR ou branch existente, duplicata exata, sinais de abuso) e avaliação pelo modelo (segurança e prompt injection, duplicata semântica, já resolvido no código, escopo e clareza), com saída `aceita | recusa | duvidosa`.
  - `aceita` segue direto para a SPEC (que já tem prévia).
  - `recusa` dá baixa: comentário curto sem expor a regra de segurança, label e fechamento como *not planned* ou *duplicate*. No começo, toda baixa passa por prévia (`triageApproval`) até o usuário confiar.
  - `duvidosa` e risco alto vão ao usuário.
- **Uma issue em andamento por repositório** no começo (`maxActive: 1`), para não tocar todas ao mesmo tempo. O limite vale **depois da triagem**: todas as issues são triadas (uma de cada vez), e uma issue à espera da revisão do usuário não segura as outras. Aceita sem vaga, a issue volta à fila no mesmo lugar e segue quando abrir vaga.
- **Épicos ficam fora da fila**: issue com sub-issues ou com um label de `source.ignoreLabels` (padrão `epic`). O trabalho está nas sub-issues, cada uma triada por si.
- Merge continua humano; a fábrica nunca dá push na branch padrão; o teste roda num container sem segredos.

**Estado:** implementado. O daemon registra a Fonte GitHub. A triagem é o primeiro passo da Tarefa (`triar`, só em projeto `type: github`):
- as regras decidem primeiro: PR mergeado ou commit que fecha a issue (recusa, `completed`), PR aberto (duvidosa), duplicata exata de issue mais antiga (recusa, `duplicate`), texto acima de 40 mil caracteres ou com frases de prompt injection (duvidosa, sem passar pelo modelo);
- sem decisão das regras, decide o modelo de `roles.triage` (ou o de `spec`), com a issue inteira, as outras issues abertas e os commits recentes:
  - **classificador estruturado** (System One, ex.: `openrouter/typesafe/jev-1.14`), o preferido: responde escolhas tipadas com probabilidades (decisão, categoria, prompt injection, duplicata entre as issues abertas), sem texto livre nem ferramentas, então o texto da issue não tem o que acionar. Injeção ≥ 50% ou confiança < 60% vão ao usuário como duvidosa. Custa cerca de US$ 0,00002 por issue;
  - **LLM**: recebe a issue delimitada como dado e entrega pela ferramenta `entregar_triagem`;
- a prévia fica em `GET /tasks/<projeto>/<card>/triage`, com o comentário exato e o motivo do fechamento; a decisão vai em `POST .../triage/decide` (`aceitar` ou `recusar`). A Tarefa recusada termina como `recusada`;
- `source.triageApproval` (padrão `true`) e `source.maxActive` (padrão 1). As issues entram em ordem de número, das mais antigas para as mais novas.
