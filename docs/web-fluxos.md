# Central web: mapa de fluxos

## Fluxos existentes e entrada pela tarefa

| Etapa | Seção | Interação |
| --- | --- | --- |
| 1. Triagem | SPEC e Tickets | Revisar prévia, aceitar ou recusar |
| 2. Grill e SPEC | Perguntas / SPEC e Tickets | Responder localmente, revisar envio externo, aprovar SPEC |
| 3. Implementação | Implementação | Acompanhar branch, tickets e commits RED/GREEN |
| 4. Review | Implementação | Consultar resultado e resumo do review |
| 5. PR/MR | Implementação | Acessar publicação no code host |
| 6. Merge humano | Implementação | Abrir PR/MR; merge permanece humano no code host |
| Retrôs | Retrôs | Consultar propostas; revisar e aprovar publicação pública |
| Auditoria | Atividade / Escritas | Consultar eventos, escritas reais, dry-run e guardrails |

O destaque “Ver próxima ação” abre a seção correspondente à pendência. A primeira abertura da tarefa prioriza triagem/SPEC em revisão, pergunta pendente e depois implementação/entrega. A troca manual de aba é mantida durante as atualizações ao vivo.

Responder pela web é uma resposta local à fábrica, inclusive se a pergunta ainda for um rascunho. Isso não publica resposta nos canais externos. Durante envio incerto, o formulário permanece indisponível.

## Reprodução observada

SF-26 (M1-18) estava em `aguardando-humano`, etapa `spec`, pergunta 1 publicada e sem resposta. A abertura na aba Atividade escondia a ação necessária em Perguntas. A mudança de interface não responde nem aprova decisões pelo usuário.

## Limites ainda existentes

- Aprovar/rejeitar propostas de conhecimento ainda é a entrega da própria M1-18: a web atual só oferece aprovação para propostas públicas da fábrica. Exibir um botão sem implementar o contrato de persistência não resolve essa lacuna.
- Não há chat livre com agente na API web atual; respostas são vinculadas às perguntas da tarefa.
- Merge não é executado pela fábrica (ADR-0005); o acesso é pelo PR/MR externo.
- A navegação das seis etapas não comprova execução do pipeline: os estados dependem do backend e das integrações.

## Referências Mobbin

Pesquisa pelo CLI `mobbin`, plataforma web. Referência visual inspecionada: Relevance AI, com lista de tarefas, timeline e ação contextual de retomada. Aplicação: separar histórico de ação necessária, mantendo estado e navegação do fluxo visíveis.

- Relevance AI: https://mobbin.com/screens/4366a3ad-efe2-464b-99e7-2ff4202948a5
- Zoho CRM (resultado de busca, não inspecionado visualmente): https://mobbin.com/screens/4b7f7902-7437-4fee-9cb0-95b7685abb26
- Twenty (resultado de busca, não inspecionado visualmente): https://mobbin.com/screens/e1115c57-801a-4b80-a8b5-05c2969b77c8

## Validação

Playwright CLI na SF-26 real, apenas leitura e edição de rascunho sem envio: abertura automática em Perguntas, navegação pela etapa Review, retorno pela próxima ação e preservação do rascunho. Testes de apresentação em `test/web-pendencias.test.ts`.
