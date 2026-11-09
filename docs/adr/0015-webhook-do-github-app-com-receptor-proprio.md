# Webhook do GitHub App com receptor próprio, fora da API local

Os repositórios monitorados (ADR-0014) passam a ser sincronizados por eventos do GitHub, e não pela busca periódica
da Fonte. A API local continua só para clientes locais (ADR-0002); o GitHub precisa de outra porta de entrada.

- **Receptor separado**: `POST /webhooks/github` num listener próprio, em `127.0.0.1` e porta `FACTORY_WEBHOOK_PORT`. É o
  único caminho que aceita requisição de fora, e só depois de um túnel (cloudflared, smee) encaminhar até ele. A API e
  a página local não mudam de regra.
- **Autenticação antes do parse**: `X-Hub-Signature-256` sobre os bytes crus, com o secret do GitHub App em
  `FACTORY_GITHUB_WEBHOOK_SECRET` (nunca na config, nunca em log). Sem o secret, o receptor não sobe.
- **Entregas idempotentes**: `X-GitHub-Delivery` das entregas já aplicadas fica no estado (as últimas 1000). O reenvio
  de uma entrega falha não é reaplicado, porque um fechamento antigo reaplicado cancelaria uma Tarefa já reaberta.
- **Sem chamada por issue**: o payload de `issues` traz a issue completa. O webhook não faz `GET` por issue.
- **Falha não se perde em silêncio**: se a aplicação falha, a resposta é 500 e a entrega aparece como falha no GitHub.
  O GitHub não reenvia sozinho: o reenvio é manual (pela interface do App ou pela API). Entrega inválida é 400 e não é
  reenviada.
- **Instalação do App**: `installation` (`created`, `deleted`, `suspend`) e `installation_repositories` (`added`,
  `removed`). Repositório removido ou instalação removida/suspensa **desativa** o projeto: as Tarefas não iniciadas são
  canceladas, e a Tarefa em execução é pausada e fica aguardando confirmação (o webhook não cancela trabalho em curso).
  Repositório adicionado reativa o projeto configurado. `unsuspend` não reativa sozinho: o replugue é manual.
- **Plugar e desplugar em runtime** (`POST /repos/plugar`, `POST /repos/desplugar`): o projeto continua vindo do YAML
  (ADR-0010). Replugar só funciona para repositório já configurado; desplugar com Tarefa em execução responde 409 até
  receber `force`, que a cancela. O vínculo desativado persiste no estado durável, e não é reiniciado com o daemon.
- **Reconciliação**: no startup, e a cada busca (`POST /poll` ou o timer), cada repositório ativo é consultado uma vez
  (`issues?state=all&since=`) desde a última sincronização gravada no estado. O que mudou e não está no estado vira uma
  entrega comum, aplicada pelo mesmo caminho do webhook. Uma versão igual não gera entrega (para não marcar execução como
  desatualizada à toa). A primeira execução só grava a linha de base. A consulta recua 60 s para cobrir edições feitas
  durante a própria consulta. Uma falha do GitHub nessa consulta não impede a busca dos cards.
- **Avisos em rajada**: avisos ao usuário passam por um agrupador (`AvisoLote`). Uma rajada do mesmo projeto e motivo
  vira um resumo com a contagem e os cards, depois de 10 s de silêncio, ou no máximo 60 s de espera. Um aviso sozinho sai
  como veio.

## Consequências

- A fábrica passa a depender de um túnel público apontando para `FACTORY_WEBHOOK_PORT` para receber eventos. Entregas
  perdidas (túnel fora, falha de aplicação) são reenviadas à mão; a reconciliação de startup, na próxima fatia, cobrirá
  o que ficou para trás sem depender de reenvio.
- As escritas continuam com a conta do usuário (ADR-0003); o App só entrega eventos nesta fatia.
- Edições em Tarefa em execução marcam o escopo como desatualizado e pausam (ver `scopeGate` em `src/durable.ts`).
