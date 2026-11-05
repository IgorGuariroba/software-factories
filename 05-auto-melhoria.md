# Auto-melhoria (loop externo)

[← Índice](index.md)

## Loop externo: meta-engenharia / auto-melhoria

O objetivo deste loop é melhorar a fábrica e os moldes, ou seja, otimizar o loop interno para que ele fique mais eficiente, rápido e barato.

Toda melhoria identificada é classificada: é do **molde** (só daquele produto) ou da **fábrica** (de todos)? Ver [Fábrica e molde](02-fabrica-e-molde.md).

O que ele busca melhorar:

- **Custo**: como diminuir o custo de token e o custo por tarefa.
- **Tempo**: como reduzir o tempo de entrega.
- **Erros**: como **evitar** (e não só corrigir) os erros já identificados no loop interno.

A `retro`, no fim do loop interno, é a ponte entre os dois loops: ela gera as melhorias que o loop externo aplica na fábrica.

### Quando roda

O loop externo roda **após cada tarefa**. Cada ciclo do loop interno que termina é analisado inteiro, enquanto os dados estão completos e frescos.

### Rastreabilidade: tudo é registrado

Para julgar um ciclo, o loop externo precisa de dados. Por isso **todo o percurso da issue é acompanhado**, desde a entrada na fábrica até a saída: a triagem, cada passo em que um agente atuou, as ferramentas usadas, os turnos, os testes, o código e o PR.

Sem esse registro completo não dá para fazer julgamento objetivo.

O que é registrado em cada etapa:

| Etapa | O que é medido |
|-------|----------------|
| **Triagem** | Resultado de cada passo (segurança, duplicação, alinhamento). Rodadas de conversa entre os dois agentes. |
| **Implementação** | Como foi: turnos, ferramentas usadas, tentativas que não deram certo. |
| **Review** | Quantas vezes o código passou pelo review e quantas vezes voltou para a implementação. |
| **CI** | Quantas vezes rodou e quantas vezes falhou e voltou para a implementação. |
| **Ciclo inteiro** | Tokens gastos e custo total, por etapa e no total. Número de rodadas. Tempo do início ao fim. |

Com esses dados dá para responder, por exemplo: *gastamos várias rodadas tentando resolver algo que, com determinada informação, teria sido resolvido em uma rodada de maneira simples?*

### Julgamento objetivo do ciclo

Cada ciclo concluído (uma issue que foi do início até o merge) passa por um julgamento. O julgamento tem que ser **objetivo**: cada dimensão tem o seu **parâmetro de eficiência**, medido a partir dos dados registrados.

| Dimensão | O que é avaliado |
|----------|------------------|
| **Eficiência do processo** | Uso eficiente das ferramentas. Turnos gastos tentando adivinhar. Tempo patinando num problema que tinha solução mais simples. |
| **Contexto** | Faltou alguma informação ou contexto para o agente? Algum hook teria facilitado o trabalho? |
| **Qualidade dos testes** | Testes frágeis ou tautológicos. |
| **Verbosidade do código** | Código poluído de comentários desnecessários ou prolixo. |
| **Verbosidade do PR** | PR prolixo. |

O resultado do julgamento vira melhoria na fábrica: um contexto que faltava, um hook novo, um ajuste numa skill, uma regra nova.

### Toda melhoria vira issue

Na fábrica e nos componentes, o loop externo **não aplica melhorias automaticamente**. Cada melhoria identificada vira uma **issue**, aberta no repositório do componente que precisa mudar. A exceção é o molde, explicada abaixo.

**Toda atualização da fábrica também vira issue.** Adicionar ou atualizar (para uma versão nova ou para a última) uma skill, ferramenta, extensão, MCP ou o pi **de uso geral** é feito por uma issue no repositório da fábrica. O objetivo é ter **registro de toda mudança na fábrica**, para saber como ela está evoluindo e o que está acontecendo.

**Mudança no molde não precisa de issue.** O molde é o agente pi de cada projeto: `AGENTS.md`, skills, rules, memória, extensões e MCPs daquele projeto. Isso é regional, só daquele projeto. Instalar uma skill nova, adicionar uma extensão ou melhorar algo do molde é feito direto, sem issue.

| Mudança em | Escopo | Precisa de issue? |
|------------|--------|-------------------|
| Skill, extensão, MCP, tool de uso geral, pi, regras e fluxo da fábrica | Fábrica (todos os projetos) | **Sim**, no repositório da fábrica. |
| `AGENTS.md`, skills, rules, memória, extensões e MCPs do projeto | Molde (só aquele projeto) | **Não**, feita direto no projeto. |
| Bug ou melhoria num componente (meu ou de terceiros) | Repositório do componente | **Sim**, no repositório do componente. |

Onde a issue de melhoria num componente é aberta:

| Melhoria em | Onde a issue é aberta |
|-------------|-----------------------|
| **Skill** | Repositório Git da skill usada no ciclo. |
| **Extensão do pi** | Repositório da extensão. |
| **Tool / ferramenta** | Repositório da ferramenta. |
| **Hook** | Repositório onde o hook vai ficar. |
| **A própria fábrica** (regras, configuração, fluxo) | Repositório da fábrica. |

**Regra:** toda skill, extensão, tool ou ferramenta usada pela fábrica precisa ter um **repositório onde dê para abrir issue**. Esse repositório **não precisa** ter o GitHub App da fábrica instalado.

O que acontece com a issue depende de quem controla o repositório:

| Repositório | GitHub App instalado? | O que acontece com a issue |
|-------------|-----------------------|----------------------------|
| **Meu, dentro da fábrica** | Sim | Entra na fábrica e passa pelo loop interno como qualquer outra demanda. |
| **Meu, fora da fábrica** | Não | Fica registrada no repositório, para eu tratar quando quiser. |
| **De terceiros** | Não | Pedido de correção ou melhoria para o mantenedor. A correção depende dele, não da fábrica. |

**Issue em terceiros: procura, verifica, publica e não acompanha.** Bug, erro ou melhoria em plugin, extensão ou skill de terceiros é publicado como issue no repositório dele.

0. **Procura antes de publicar**: quem procura é o **agente publicador**, o modelo encarregado de publicar a issue, e não uma regra fixa da fábrica. É ele quem busca e julga se já existe issue sobre o mesmo problema. Ele procura no repositório do terceiro, em issues **abertas e fechadas**, se alguém (qualquer pessoa, não só a fábrica) já reportou o mesmo problema ou a mesma melhoria.

   | Encontrou? | O que o agente publicador faz |
   |------------|---------------------|
   | **Não** | Segue para a verificação de saída e publica uma issue nova. |
   | **Sim, e falta informação** | Comenta na issue existente só com o que ainda não foi dito. O comentário também passa pela verificação de saída. |
   | **Sim, e já está tudo dito** | Não publica nem comenta. |
   | **Sim, fechada, e o componente não está na última versão** | É indício de que o problema já foi resolvido numa versão nova. O caminho é **atualizar o componente**, não publicar no terceiro: por issue de atualização, se o componente for da fábrica; direto, se for do molde (ver [Toda melhoria vira issue](#toda-melhoria-vira-issue)). |
   | **Sim, fechada, e o componente já está na última versão** | O problema persiste mesmo atualizado. Aí sim o agente publicador **abre uma issue nova** no terceiro. |

   Em todos os casos, o agente publicador registra na [memória](06-memoria.md) que o problema já está reportado, com o link da issue. Isso resolve o caso do componente compartilhado: se o projeto A já publicou, o projeto B encontra a issue na procura e não publica de novo, mesmo sem ver a memória do projeto A.

1. **Verificação de saída**: antes de publicar, a issue passa por uma verificação de segurança para não levar conteúdo sensível ao repositório de terceiros (segredos, código privado, logs, dados dos meus projetos).
2. **Publicação direta**: passando na verificação, a issue é publicada sem passar por mim.
3. **Não acompanha**: depois de publicada, a issue não é acompanhada. Se o terceiro corrigir, a correção chega pelo processo normal de atualização: manter o pi, as skills e as extensões atualizados (por issue, quando o componente é da fábrica).

Assim, todo o processo de auto-melhoria fica **registrado e catalogado**: cada melhoria tem uma issue, mesmo quando a correção não está sob o meu controle. Quando o repositório está na fábrica, a mudança também tem PR e merge, e passa pela mesma triagem, revisão e CI.


### Origem da issue: humana ou automática

Toda issue tem a origem identificada:

| Origem | Como identificar | Label |
|--------|------------------|-------|
| **Humana** | Aberta por uma pessoa. | `fabrica:origem-humana` |
| **Automática** | Aberta pela fábrica (loop externo). O autor é o próprio GitHub App (`<app>[bot]`). | `fabrica:origem-automatica` |

A origem vem do **autor da issue**, e não só da label: o autor `[bot]` não pode ser falsificado, enquanto uma label pode ser colocada por qualquer colaborador. A label só facilita o filtro.

A origem é também um dado para o loop externo: dá para comparar o resultado das melhorias automáticas com o das manuais. Melhorias que vêm de ciclo automático pedem mais cuidado na aplicação.

### Limite de gerações de melhoria

Uma melhoria pode gerar outra melhoria, que gera outra, sem fim:

```
issue #1 (humana) → ciclo → melhoria #2 (automática) → ciclo → melhoria #3 → ciclo → melhoria #4 → ...
```

Para evitar isso:

1. Toda issue automática aponta para a **issue que a gerou** e carrega o número da sua **geração** (#2 é geração 1, #3 é geração 2, e assim por diante).
2. **Limite: 2 gerações** a partir da issue original, pelo [mínimo seguro](01-principios.md#limites-começam-no-mínimo-seguro). Se os dados mostrarem que é pouco, sobe para 3.
3. Atingido o limite, o loop externo **não abre** a próxima issue automática. Ele registra a melhoria sugerida e aciona um humano, como no [limite de voltas](04-linha-de-montagem.md#limite-de-voltas).

## Questões em aberto

- Qual é o parâmetro concreto de cada dimensão do julgamento (ex.: número de turnos, chamadas de ferramenta repetidas, linhas de comentário por linha de código)? Qual valor conta como bom ou ruim?
- Quem faz o julgamento: um agente juiz separado, um script com métricas ou os dois?
- Onde ficam guardados os registros de cada ciclo (logs da sessão, comentários na issue, banco)?
- O loop externo também roda para issues que não chegaram à implementação (rejeitadas, duplicadas) e para as que pararam no limite de voltas?
- Quem faz a verificação de saída das issues para terceiros: o Jev, outro modelo ou uma ferramenta de detecção de segredos? Se ela barrar a issue, o que acontece?
- Que critérios o classificador molde/fábrica usa? Um sinal útil para ele: o mesmo problema aparecendo em mais de um projeto indica que é da fábrica.
- Além do caso da issue fechada, como a fábrica descobre que existe versão nova de um componente: verificação periódica (ex.: uma vez por semana), algo como o Dependabot, ou só quando um problema aparece?
- Quem faz a mudança direta no molde: o próprio loop externo, no fim do ciclo, ou o agente pi do projeto durante o trabalho? Ela vai por commit direto na branch principal ou por PR sem issue?
- Sem issue, como fica o registro da evolução do molde: só o histórico do Git do projeto basta?
- Quando uma skill ou extensão do molde passa a ser útil em mais de um projeto, ela é promovida para a fábrica (com issue)? Quem percebe isso: o [classificador molde/fábrica](02-fabrica-e-molde.md)?
- A issue de atualização leva a versão atual, a nova e o changelog entre elas, para a revisão saber o que muda?
- E se a issue fechada foi fechada como `not planned` (o mantenedor não vai corrigir)? Abrir uma nova pode ser visto como insistência. Nesse caso só registra na memória, com o caminho que contorna o problema?
