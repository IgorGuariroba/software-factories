# Reconciliar o estado em vez de garantir a entrega de mensagens

**Estado:** aceita, não implementada. Plano: [fase 2](../plano-evolucao-arquitetura.md#fase-2-uma-decisão-por-efeito) (saída) e [fase 3](../plano-evolucao-arquitetura.md#fase-3-entrada-por-reconciliação-e-escrita-pelo-app) (entrada).

Jira, GitHub e GitLab não aceitam chave de idempotência, e um webhook pode chegar repetido, fora de ordem ou não chegar. Em vez de montar inbox, outbox com despachante e recibos, decidimos tratar os dois lados por reconciliação: na entrada, um evento só diz o que reler; na saída, cada efeito descreve o estado desejado e a fábrica confere o remoto antes de escrever. Substitui, na [ADR-0015](0015-webhook-do-github-app-com-receptor-proprio.md), a aplicação do payload e a lista de entregas já aplicadas.

- **Entrada.** O receptor confere a assinatura e agenda a reconciliação do repositório ou da issue citada. O conteúdo do payload não é aplicado. A busca periódica continua cobrindo o que o webhook perder.
- **Saída.** Todo efeito tem um identificador determinístico (Tarefa, passo, ação, destino e hash do conteúdo) e uma de três formas:
  - **convergente**: lê o remoto e só escreve a diferença (comentário editado no lugar, transição, push, PR/MR da branch);
  - **com marca**: leva o identificador no próprio conteúdo e procura por ele antes de criar (issue de retrô);
  - **única**: não há como conferir (mensagem no Teams). A reserva é gravada antes; se o processo cai no meio, o efeito fica `incerto` e não é repetido sem uma pessoa.
- **Registro de efeitos.** A reserva e o resultado são gravados no mesmo commit do passo da Tarefa. É ele que responde "isto já foi feito?", também no dry-run.
- **Sem promessa de "exatamente uma vez".** O que se garante é que nenhum efeito é repetido às cegas.

## Considered Options

- Outbox transacional com despachante e recibos: rejeitado. O passo durável já é a unidade de nova tentativa; um despachante criaria um segundo laço de repetição e teria de preservar a ordem dos efeitos de uma Tarefa (push antes do PR). Cada efeito ainda precisaria da própria consulta ao remoto, que é o que resolve o problema.
- Inbox por identificador de entrega, com controle de revisão: rejeitado, porque reler o estado atual dispensa deduplicar e ordenar.
- Leases com token crescente para invalidar executores atrasados: rejeitado, por não haver executor fora do processo (ADR-0023, ADR-0032).

## Consequências

- Cada evento custa uma consulta ao GitHub, o que a ADR-0015 evitava.
- Uma issue apagada não aparece na consulta por data. O aviso do webhook leva a identidade dela, e a fábrica a relê.
- Os estados `sending`, `attempted` e `uncertain`, hoje espalhados pelas perguntas e avisos, passam a ser um só registro.
