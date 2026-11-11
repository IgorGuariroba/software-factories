# Fábrica de Software

Agente autônomo e auto-hospedado que pega demandas atribuídas ao usuário e as leva do card até o merge, conversando com as pessoas do projeto e agindo em nome do usuário.

## Demanda e trabalho

**Projeto**:
Unidade de configuração da fábrica, que reúne a fonte, os canais, os perfis e as pessoas do projeto, o repositório, os provedores permitidos e as evidências disponíveis de um contexto de trabalho. Sua configuração é editada pelo usuário.
_Avoid_: workspace, cliente

**Projeto incompleto**:
Projeto que ainda não tem algum item obrigatório (repositório, Fonte, PO, Canal, comando de teste). Não executa, e a interface lista o que falta.

**Projeto ativo**:
Projeto com todos os itens obrigatórios preenchidos, que a fábrica executa, em ensaio ou não.

**Projeto pausado**:
Projeto ativo que o usuário suspendeu, sem perder a configuração.

**Repositório**:
Código de um projeto, hospedado no GitHub ou no GitLab. Cada projeto tem exatamente um repositório, e um mesmo repositório pode servir a mais de um projeto.
_Avoid_: repo (em texto corrido), código

**Fonte**:
Sistema de onde a fábrica obtém demandas (Jira, GitHub Issues, GitLab Issues). Cada projeto tem uma única Fonte, que pode ser diferente do repositório do projeto (ex.: Jira para demandas, GitLab para código).
_Avoid_: origem, provider de tarefas, source

**Card**:
Uma demanda individual na fonte, com status, responsável e comentários.
_Avoid_: issue (quando a fonte for Jira), ticket

**Tarefa**:
O trabalho da fábrica sobre um card, do momento em que ela o assume até o card chegar a `Concluído`.
_Avoid_: job, execução, run

**Assumir**:
Ato da fábrica de tomar um card como tarefa, anunciado no card e, se o card já estava em andamento, sujeito a veto.
_Avoid_: pegar, claim

**Veto**:
Recusa do usuário, dentro de um prazo, a que a fábrica assuma ou continue uma tarefa.

**Fila**:
Ordem em que as tarefas assumidas aguardam execução.

## Pipeline

**Etapa**:
Uma fase da tarefa com objetivo próprio: grill, SPEC, tickets, implementação, review, teste, rodada de MR.
_Avoid_: step, fase (quando ambíguo com status do card)

**SPEC**:
Comentário no card que descreve o que será entregue e quais evidências provam cada critério de aceite. Fica sempre atualizado no lugar.
_Avoid_: especificação em arquivo, PRD

**Tickets**:
Comentário-checklist no card com as fatias de implementação da SPEC, editado no lugar.
_Avoid_: subtarefas

**Loop**:
Repetição de uma etapa (ou de um par de etapas) motivada por falha ou feedback, com limite próprio.
_Avoid_: retry (quando houver feedback envolvido)

**Rodada de MR**:
Um ciclo de comentários humanos no MR seguido das correções da fábrica.

**Teste próprio**:
Validação que a própria fábrica executa no ambiente de teste depois do build, obrigatória antes de mover o card para `Aguardando Teste`.
_Avoid_: QA, homologação

**Evidência**:
Artefato que prova um critério de aceite, como um print anotado, uma resposta de endpoint ou um resultado de consulta, publicado no card.

**Portão humano**:
Ponto em que a fábrica não age e espera um humano. O merge do MR é sempre um; os demais são as prévias que a política de ações do projeto pede.

**Guardrail**:
Ação que a fábrica está proibida de executar, qualquer que seja a instrução recebida.

**Efeito externo**:
Mudança que a fábrica provoca num sistema fora dela: a Fonte, o repositório remoto, um Canal ou o serviço de uma ferramenta.
_Avoid_: side effect, escrita (quando inclui mensagens e ferramentas)

**Política de ações**:
Regra do projeto que diz, para cada tipo de efeito externo, se a fábrica executa, pede prévia, só registra ou não faz.
_Avoid_: permissões, modo

**Prévia**:
Conteúdo exato de um efeito externo, mostrado ao usuário para aprovação antes de acontecer. A aprovação vale só para aquele conteúdo e aquele destino.
_Avoid_: preview, confirmação

**Tipo de mudança**:
Natureza da alteração de uma Tarefa (documentação, comportamento ou alto risco), que define a evidência mínima antes de publicar.
_Avoid_: perfil (é a função de uma pessoa), categoria

## Pessoas e conversa

**Usuário**:
A pessoa dona da fábrica, em nome de quem ela age e com cujas credenciais ela opera.
_Avoid_: operador, dono

**Pessoa do projeto**:
Pessoa com quem a fábrica pode conversar num projeto. Tem um identificador na Fonte do projeto (ex.: accountId no Jira, login no GitHub) e, para cada Canal pelo qual a fábrica fala com ela, um identificador nesse Canal (ex.: id no Teams). Pode ocupar um ou mais perfis.
_Avoid_: usuário (usado só para o dono da fábrica), membro, contato

**Perfil**:
Função de uma pessoa do projeto (PO, tech lead, ou outra que o projeto definir). PO e tech lead são obrigatórios para o projeto ficar ativo. Um perfil pode ter várias pessoas, e uma pessoa pode ter vários perfis. Define para quem a fábrica encaminha perguntas e lembretes, na ordem cadastrada. Não concede autoridade: vetos e aprovações continuam com o usuário.
_Avoid_: papel (usado para modelos), cargo, role

**Canal**:
Meio de conversa da fábrica com as pessoas do projeto (Teams, comentário no card). Cada pessoa usa o canal que lhe cabe.
_Avoid_: interface (são conceitos distintos), Telegram (é interface de gestão)

**Agente da etapa**:
Configuração de uma etapa (modelo, prompt de sistema, tools, MCPs, skills e memória) que roda como agente independente, editável pela interface de gestão.
_Avoid_: agente (sozinho), worker

**Skill**:
Bloco de instruções versionado no conhecimento do projeto, ativado por Agente da etapa e incluído no prompt dele.
_Avoid_: skill do Claude Code, plugin

**Memória da etapa**:
Contexto persistido da conversa de um Agente da etapa, segmentado por tarefa e etapa e isolado por projeto.
_Avoid_: conhecimento do projeto (que é compartilhado entre tarefas)

**Trace**:
Registro das chamadas de tool, mensagens e resultados de uma execução de Agente da etapa, visível ao vivo e no histórico da tarefa.
_Avoid_: log

**Interface de gestão**:
Meio pelo qual só o usuário acompanha e comanda a fábrica (web local, Telegram). Não fala com as pessoas do projeto.
_Avoid_: canal, painel, dashboard

**Pergunta de negócio**:
Dúvida sobre regra ou intenção da demanda, que vai ao PO.

**Pergunta técnica**:
Dúvida sobre implementação, que vai primeiro ao usuário e depois ao tech lead.

**Escalonamento**:
Passagem de uma pergunta sem resposta para a próxima pessoa ou para um lembrete, conforme prazos em horas úteis.

## Modelos

**Plano**:
Uma assinatura ou conta de acesso a modelos (Claude, Codex, Cursor, Antigravity, OpenRouter).
_Avoid_: provedor (quando se refere à conta), subscription

**Provedor permitido**:
Plano que um projeto autoriza a receber seu conteúdo. Nenhum outro plano é usado, nem como fallback.

**Papel**:
A função que um modelo exerce numa tarefa: grill/SPEC, implementador, reviewer, tester, roteador.
_Avoid_: agente, persona

**Classe**:
Nível de capacidade de um modelo: A (high-end), B (intermediário) ou C (básico). Cada papel exige uma classe mínima.
_Avoid_: tier

**Cota**:
Fração ainda disponível do limite de uso de um plano, com o momento do próximo reset.

**Orçamento**:
Limite de gasto de uma Tarefa em tokens, tempo ativo e tentativas. Ao atingi-lo, a Tarefa para e o usuário decide.
_Avoid_: cota (é do plano), budget

**Modelo de escalada**:
Modelo que uma etapa passa a usar, uma única vez, depois de recusas seguidas do modelo configurado. Só existe se o usuário o configurar.
_Avoid_: fallback

## Aprendizado

**Retrô**:
Avaliação de desempenho feita ao fim de cada etapa e, de forma consolidada, ao fim da tarefa.

**Proposta de retrô**:
Melhoria sugerida por uma retrô, que vira issue da fábrica, mudança no conhecimento do projeto (sujeita a aprovação) ou sugestão ao usuário.

**Conhecimento do projeto**:
Memória local e privada da fábrica sobre um projeto (padrões, armadilhas, critérios de review), fora do repositório do time.
_Avoid_: docs, wiki

**Dry-run**:
Modo em que a fábrica lê os sistemas de verdade e apenas registra as escritas que faria.
_Avoid_: simulação, modo teste

## Sincronização

**Entrega**:
Evento que o GitHub envia ao receptor do webhook quando uma issue muda. Cada entrega tem um identificador próprio, e
o reenvio de uma entrega falha usa o mesmo identificador.
_Avoid_: notificação, callback

**Receptor do webhook**:
Porta local que recebe as entregas do GitHub App, atrás de um túnel. Só aceita entregas com assinatura válida.
_Avoid_: API, endpoint público

**Escopo desatualizado**:
Estado de uma Tarefa cujo card mudou no GitHub depois de a Tarefa começar a executar. A SPEC é refeita, ou a Tarefa
para se a implementação já começou.
_Avoid_: spec obsoleta, drift
