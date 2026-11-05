# Fábrica de Software — Conceitos Base

## Objetivo

Entrar uma demanda e sair o produto pronto, **sem depender de ação minha**.

A fábrica deve entregar:

- **Rápido**: pouco tempo entre a demanda e a entrega.
- **Melhor**: com qualidade.
- **Com eficiência**: sem desperdício de esforço.
- **Barato**: com custo baixo por entrega.
- **A qualquer hora**: funciona o tempo todo (24/7).

### O problema de hoje

Hoje eu programo com um agente na linha de comando, mas sou eu quem inicia, acompanha e para o trabalho. Quando fecho o notebook ou desligo o computador, tudo para. A produção depende da minha presença.

### O que muda com a fábrica

O trabalho deixa de depender de mim e do meu computador. A fábrica roda sozinha, de forma contínua: recebe a demanda, executa e entrega.

## Princípios

### Mínimo

Implementar sempre **o menor escopo** que resolve a demanda, da maneira menos custosa.

#### Limites começam no mínimo seguro

Todo limite da fábrica (voltas, gerações, qualquer ciclo do loop interno ou externo) começa com o **mínimo seguro**: o menor valor que permite trabalhar, em geral 2 ou 3, e não muito mais que isso.

Os limites são **ajustados com o tempo**. A fábrica se auto-melhora: com menos tokens, menos ciclos e mais objetividade, ela tende a precisar de menos voltas, e não de mais. Se os dados do loop externo mostrarem que um limite está apertado demais, ele é aumentado, sempre por issue, como qualquer outra melhoria.

| Limite | Valor inicial | Onde é usado |
|--------|---------------|--------------|
| Voltas por issue | 3 | [Limite de voltas](setores/02-linha-de-montagem.md#limite-de-voltas) (loop interno) |
| Gerações de melhoria | 2 | [Limite de gerações de melhoria](setores/03-auto-melhoria.md#limite-de-gerações-de-melhoria) (loop externo) |

### Seguro

Segurança vem **em primeiro lugar** em toda decisão de implementação. Uma solução mais barata ou mais simples não é escolhida se for menos segura.

### Autônomo e visível

A fábrica precisa **funcionar sem o humano**, o máximo possível. Mas ela **não pode ser uma caixa preta**.

- **Visibilidade**: um humano pode ver, a qualquer momento, o que está acontecendo: o que está em andamento, em que etapa, o que está parado e por quê.
- **Comunicação**: quando precisa do humano, a fábrica **notifica**. Ela não espera que alguém perceba sozinho.

Os casos em que a fábrica chama o humano estão em [Humano e visibilidade](setores/06-humano-e-visibilidade.md).

### Critérios de decisão

Quando houver mais de uma forma de implementar, a escolha segue esta ordem de prioridade:

1. **Segurança**: a opção mais segura.
2. **Custo financeiro**: a opção que não exige (ou exige menos) assinatura, plano ou pagamento de algum serviço.
3. **Manutenibilidade**: a opção mais fácil de manter e evoluir.

> **Custo aqui é dinheiro**, não esforço. Dias de trabalho e consumo de tokens **não** entram como critério de escolha da solução. Esse custo operacional é tratado pelo loop externo, que otimiza a fábrica.

## Fábrica e molde

A fábrica fabrica produtos a partir de **moldes**. Cada **projeto** (repositório) é o **molde do produto**: é nele que está o jeito específico de fabricar aquele produto, com as suas peculiaridades.

| | Fábrica | Molde (projeto) |
|---|---------|-----------------|
| **O que é** | O **equipamento**: tudo o que é usado para criar os produtos. | O jeito de fabricar um produto específico. |
| **O que contém** | Loops, triagem, regras, tools e ferramentas do agente, skills, MCPs e extensões de uso geral. | O agente pi do projeto: `AGENTS.md`, skills, rules, MCPs, extensões e hooks específicos do projeto, [memória de problemas conhecidos](setores/04-memoria.md). |
| **Onde fica** | Repositório da fábrica (e dos componentes). | Repositório do projeto. |
| **Vale para** | Todos os projetos. | Só aquele produto. |

Uma skill, um MCP ou uma extensão pode ser de qualquer um dos dois lados:

- **Do molde**, quando resolve um ponto específico daquele projeto.
- **Da fábrica**, quando resolve um problema geral e passa a ser ferramental de todos os projetos.

Por isso existem **dois tipos de melhoria**, e é importante diferenciá-los:

- **Melhoria no molde**: problema focado, na construção de um produto específico. Melhora-se o molde, não a fábrica.
- **Melhoria na fábrica**: problema generalizado, no processo ou no equipamento, que afeta todos os produtos. A fábrica tem o seu próprio processo de melhoria.

Quem classifica a melhoria é um **modelo inteligente** no loop externo. A diferença entre molde e fábrica depende de julgamento e não dá para resolver com uma regra fixa.

## Fluxo

A fábrica funciona com **dois loops**:

1. **Loop interno (linha de montagem)**: entrega o que foi pedido.
2. **Loop externo (meta-engenharia / auto-melhoria)**: melhora a própria fábrica.

Detalhes de cada etapa estão nos [setores](#setores-da-fábrica).

### Loop interno: linha de montagem

O loop interno tem duas fases: **triagem** e **implementação**. Só o que passa pela triagem chega à implementação.

```
issue
  │
  ▼
TRIAGEM
  1. segurança ─────────────────────────────── ✗ ──▶ rejeitada
  │
  2. duplicada / já resolvida / em andamento ── ✗ ──▶ ligada à existente
  │
  3. grill (2 agentes) → to-spec → to-tickets
  │
  ▼
IMPLEMENTAÇÃO
  tdd → code-review → PR → CI → merge
   ↑        │               │
   └────────┴─ correção ────┘
  │
  ▼
retro ──▶ loop externo
```

## Setores da fábrica

Cada setor tem o seu arquivo, com o conteúdo e as questões em aberto daquele setor.

| Setor | Arquivo | O que trata |
|-------|---------|-------------|
| 1. Entrada e triagem | [setores/01-entrada-e-triagem.md](setores/01-entrada-e-triagem.md) | Issue como porta de entrada, GitHub App, segurança (Jev, padrões, falso positivo), duplicação, alinhamento. |
| 2. Linha de montagem | [setores/02-linha-de-montagem.md](setores/02-linha-de-montagem.md) | Implementação, limite de voltas, PR, merge, encerramento da issue. |
| 3. Auto-melhoria | [setores/03-auto-melhoria.md](setores/03-auto-melhoria.md) | Loop externo: rastreabilidade, julgamento, toda melhoria vira issue, terceiros, origem, limite de gerações. |
| 4. Memória | [setores/04-memoria.md](setores/04-memoria.md) | Memória de problemas conhecidos (OKF) no molde. |
| 5. Modelos | [setores/05-modelos.md](setores/05-modelos.md) | Níveis de modelo, distribuidor, cotas. |
| 6. Humano e visibilidade | [setores/06-humano-e-visibilidade.md](setores/06-humano-e-visibilidade.md) | Quando o humano é chamado, notificação, acompanhamento. |

## Papéis

| Papel | Etapa | Responsabilidade |
|-------|-------|------------------|
| Juiz de segurança (Jev) | Triagem (passo 1) | Avalia se a issue ou o comentário tem prompt injection ou pedido malicioso. Rejeita a entrada insegura. |
| Verificação de saída | Loop externo | Confere se a issue para terceiros não leva conteúdo sensível antes de publicar. |
| Classificador molde/fábrica | Loop externo | Modelo inteligente que decide se a melhoria é do molde ou da fábrica. |
| Agente publicador | Loop externo | Publica as issues de melhoria. Antes, procura se já existe issue sobre o mesmo problema (abertas e fechadas) e decide: publicar, comentar, não publicar ou atualizar o componente. Registra na memória. |
| Distribuidor de modelos | Toda a fábrica | Modelo de topo de cadeia que decide qual modelo faz cada tarefa, pela complexidade e pela disponibilidade de cota. |
| Eu (autor da fábrica) | Segurança | Edito a lista de padrões de prompt injection. Marco falsos positivos. |
| Humano | Limite de voltas | Entra no loop quando um ciclo passa de 3 voltas. Investiga e decide: revê a issue, destrava o trabalho ou abre issues de melhoria. |
| Humano | Merge manual | Revisa as evidências do PR e faz o merge. |
| Humano | Qualquer etapa | Acompanha o que está acontecendo. Atende as notificações: destrava processo parado, aprova ações, avalia melhoria no limite de gerações. |
| Agente questionador | Triagem | Levanta causas, perguntas e alternativas de implementação. |
| Agente decisor | Triagem | Escolhe a melhor opção seguindo os critérios de decisão. |

## Padrões e ferramentas

- **Plataforma**: GitHub.
- **Entrada**: issues do repositório.
- **Conexão com os projetos**: GitHub App instalado em cada repositório.
- **Saída**: PR com evidências; merge manual ou auto-merge.
- **Agente**: pi, conectado a vários provedores de modelos.

## Questões em aberto (gerais)

- Onde a fábrica roda se não for no meu computador (servidor, nuvem)?
- Como medir "rápido", "melhor" e "barato"?
