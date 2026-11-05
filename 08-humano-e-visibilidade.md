# Humano e visibilidade

[← Índice](index.md)

## Quando a fábrica chama o humano

Pelo princípio [Autônomo e visível](01-principios.md#autônomo-e-visível), a fábrica funciona sem o humano o máximo possível. Há coisas que não dão para seguir sem ele. São as exceções, e não a regra:

| Situação | O que a fábrica pede ao humano |
|----------|--------------------------------|
| **Processo parado** | Que destrave o trabalho. |
| **[Limite de voltas](04-linha-de-montagem.md#limite-de-voltas)** atingido | Que investigue e decida. |
| **[Limite de gerações](05-auto-melhoria.md#limite-de-gerações-de-melhoria)** atingido | Que avalie a melhoria sugerida. |
| **Merge manual** | Que revise as evidências e faça o merge. |
| **Aprovação necessária** | Que aprove a ação para a fábrica continuar. |

## Questões em aberto

- Além das situações da tabela acima, em que outros pontos eu ainda participo, se participo (priorizar, desempatar a triagem)?
- Como o humano é notificado (vale para todas as situações da tabela acima): label na issue (ex.: `fabrica:precisa-humano`), menção no GitHub, mensagem em outro canal (e-mail, Telegram, notificação no celular)?
- Onde o humano vê o que está acontecendo: só no GitHub (labels de etapa na issue, comentários de progresso, um quadro do GitHub Projects) ou num painel próprio?
- Como a fábrica percebe que um processo está parado: tempo sem progresso numa etapa (ex.: X horas), processo que morreu, erro repetido?
- Quais ações exigem aprovação do humano? Ex.: gastar dinheiro (API paga por uso), mexer em segredos ou permissões, publicar fora dos meus repositórios.
- Se o humano não responde a uma notificação, a fábrica lembra de novo, espera parada ou segue com outras issues?
