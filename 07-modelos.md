# Modelos e distribuição de trabalho

[← Índice](index.md)

Os modelos são classificados em **três níveis**, conforme a complexidade do problema que resolvem:

| Nível | Resolve |
|-------|---------|
| **Topo de cadeia** (grandes) | Problemas complexos, que só um modelo grande resolve. |
| **Intermediário** | Problemas medianos. |
| **Básico** | Problemas básicos, que qualquer modelo resolve sempre. |

## Distribuidor de modelos

Um agente com **modelo de topo de cadeia** decide **qual modelo faz cada tarefa**. Ele é o responsável pela distribuição do trabalho na fábrica. Precisa ser de topo porque delegar a tarefa certa ao modelo certo exige inteligência.

Ele mantém uma **lista atualizada** de:

- modelos disponíveis, por provedor;
- cotas restantes de cada plano ou assinatura;
- limites (cota de 5 horas, da semana, do mês).

**Classificação de modelos novos:** quando aparece um modelo novo, o próprio distribuidor **pesquisa sobre ele na internet** e o classifica como topo, intermediário ou básico. A partir daí o modelo entra na distribuição, de acordo com a disponibilidade, as cotas e o plano.

Para decidir, ele considera:

1. **A complexidade da tarefa**: qual nível de modelo ela pede.
2. **A disponibilidade do modelo**: os planos e as assinaturas têm cota, e nem sempre estão disponíveis (cota esgotada, assinatura parada).

Ele escolhe o modelo de **toda parte da fábrica** que usa modelo: triagem (questionador, decisor), implementação, review, julgamento do ciclo, classificação molde/fábrica, agente publicador, verificação de saída, entre outras.

A base para isso é o **pi**, que se conecta a vários provedores. A fábrica usa essa capacidade para escolher o modelo certo para cada problema entre os provedores disponíveis no momento.

O próprio distribuidor também depende de cota, porque usa um modelo de topo de cadeia.

## Questões em aberto

- O distribuidor de modelos decide a cada tarefa ou uma vez por issue (ex.: na triagem, já define o nível de cada etapa)?
- Como o distribuidor sabe a cota restante de cada assinatura? Nem todo provedor expõe isso; pode ser preciso descobrir pela falha (erro de limite) e registrar.
- O que acontece quando o modelo do nível certo não tem cota: a tarefa espera a cota voltar, sobe para um nível acima ou desce para um abaixo?
- O que acontece quando o próprio distribuidor (topo de cadeia) está sem cota?
- Planos de assinatura (custo fixo) têm prioridade sobre API paga por uso, pelo [critério de custo financeiro](01-principios.md#critérios-de-decisão)? A API paga por uso entra quando a cota acaba ou nunca entra?
- O Jev fica fora do distribuidor? Ele precisa continuar sendo um modelo diferente dos agentes que trabalham.
- O loop externo avalia se a escolha de modelo foi boa (ex.: tarefa básica feita por modelo de topo, ou modelo básico que patinou)?
- Onde fica a lista de modelos, cotas e limites do distribuidor, e com que frequência é atualizada (antes de cada tarefa, a cada X minutos)?
- Como o distribuidor percebe que apareceu um modelo novo: consulta periódica à lista de modelos de cada provedor no pi, ou quando eu adiciono um provedor ou plano?
- Em que fontes ele se baseia para classificar (benchmarks públicos, documentação do provedor)? Conteúdo da internet pode trazer prompt injection: a pesquisa passa por alguma verificação de segurança?
- A classificação é revista depois com base no desempenho real nos ciclos (o loop externo pode mostrar que um modelo "intermediário" patina muito)?
