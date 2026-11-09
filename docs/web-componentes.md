# Interface web: componentes e validação

## Escopo

Primeira rodada de refinamento da interface existente, sem migrar HTML/CSS/JS para React nem adicionar dependências. Preserva API, SSE, aprovações e regras de negócio. Os componentes da lista `pick-ui-library` não justificam uma migração de stack para ajustes de layout; o diálogo permanece o `<dialog>` nativo.

## Inventário funcional

| Componente | Função | Implementação |
| --- | --- | --- |
| Cabeçalho e selos | Mostrar conexão SSE e estado do daemon | `index.html`, `connect`, `renderDaemon` |
| Controles globais | Pausar/retomar daemon e buscar demandas na Fonte | `app.js`, `api.js` |
| Configuração de publicações | Escolher repositório global das retrôs; salvar não publica | `<dialog>`, `openRetroSettings` |
| Cards elegíveis | Consulta sob demanda de cards disponíveis | `<details>`, `refreshQueue` |
| Quadro | Distribuir tarefas entre Triagem, SPEC, Implementação, Review, PR/MR e Encerradas | `boardColumns`, `renderTasks` |
| Cartão | Chave, projeto, título, situação, tentativas e próxima ação | `taskCard`, `cardHint` |
| Ordenação | Subir/descer tarefas não encerradas | `moveButton`, `moveTask` |
| Detalhe | Abrir tarefa pelo hash e mostrar situação e comandos contextuais | `renderDetail`, `refreshDetail` |
| Próxima ação | Encaminhar para a seção da pendência ou retomar tarefa pausada | `nextAction`, `actionTab` |
| Pipeline | Mostrar seis etapas, estado atual e atalhos para seções | `pipelineSteps` |
| Abas | Seis painéis; teclado com setas, Home e End | `showTab` |
| Atividade | Eventos em ordem recente, com tipo e data | `activity` |
| SPEC e Tickets | Triagem, revisão/decisão, SPEC e aceite dos tickets | `reviewTriageButton`, `reviewSpecButton` |
| Implementação | Branch, commits RED/GREEN, review e link PR/MR | `renderDetail` |
| Perguntas | Resposta local, revisão de envio e lembrete; preserva rascunhos | `answerForm`, `reviewQuestionButton`, `reviewReminderButton` |
| Retrôs | Sugestões e revisão explícita de publicações públicas | `reviewRetroButton` |
| Escritas | Auditoria de efeitos reais, dry-run e guardrails | tabela, `writeSituation` |
| Alertas e vazios | Erros, ausência de tarefa/atividade/perguntas e etapas sem tarefas | `showError`, `renderTasks`, `renderDetail` |

## Alterações desta rodada

- Maior espaçamento nos cartões e distinção das colunas.
- Botões globais com destaque para a ação principal; foco visível também em inputs e summaries.
- Alvos de toque de pelo menos 44 px no celular, inclusive ordenação.
- Detalhe em tela cheia abaixo de 960 px, sem cortar o cabeçalho em uma coordenada fixa de 56 px.
- Abas com rolagem horizontal própria, sem quebrar em várias linhas.
- Auditoria com rolagem própria e textos longos com quebra onde necessário.
- Mensagens explícitas para colunas e atividade vazias.
- Transições dos cartões desativadas com preferência por movimento reduzido.

## Validação em 2026-11-07 (horário local)

Playwright CLI, navegador isolado, daemon existente em `http://127.0.0.1:7420/`. Nenhum token de extensão foi necessário. Não foram enviados comandos de alteração, respostas ou aprovações ao daemon real.

### Medições

- Antes, viewport 390 × 844: botões globais com 26,48 px de altura; cabeçalho de 116,06 px e detalhe começando em y=56, cobrindo parte do cabeçalho.
- Depois: botões globais com 44 px; detalhe começando em y=0 e ocupando a tela, sem sobreposição parcial.
- Largura do documento no celular: 390 px para viewport de 390 px, sem overflow horizontal global.

### Fluxos exercitados com assertions

- Quadro desktop em 1440 × 900 e abertura de tarefa no celular.
- Navegação nas seis abas e visibilidade do painel associado.
- ArrowRight a partir de Atividade seleciona SPEC.
- Fechar detalhe retorna ao quadro.
- Abrir configuração e fechar com Escape, sem salvar.
- Ausência de overflow global no celular em tema escuro com movimento reduzido.

### Checks do repositório

`npm run typecheck`, `npm run lint` e `npm test` concluídos: 427 testes passaram, 3 ignorados. Lint retornou três warnings de especificidade CSS, sem erros.

### Evidências locais

Imagens anotadas em `~/Downloads/e2e-factory-ui-ANTES-mobile.png` e `~/Downloads/e2e-factory-ui-DEPOIS-mobile.png`. Capturas brutas desktop e mobile em `/tmp/factory-{desktop,mobile}-{before,after}.png`.

## Limites

Esta rodada não é um redesign completo nem teste de todos os estados de negócio. Revisões, publicação, respostas, ordenação e comandos globais foram mapeados no código, mas não executados contra integrações reais. Aprovação de conhecimento continua indisponível na interface; merge continua humano no code host. A responsividade foi validada em navegador desktop com viewport móvel, não em aparelho físico.
