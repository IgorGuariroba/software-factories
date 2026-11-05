# Princípios

[← Índice](index.md)

## Mínimo

Implementar sempre **o menor escopo** que resolve a demanda, da maneira menos custosa.

### Limites começam no mínimo seguro

Todo limite da fábrica (voltas, gerações, qualquer ciclo do loop interno ou externo) começa com o **mínimo seguro**: o menor valor que permite trabalhar, em geral 2 ou 3, e não muito mais que isso.

Os limites são **ajustados com o tempo**. A fábrica se auto-melhora: com menos tokens, menos ciclos e mais objetividade, ela tende a precisar de menos voltas, e não de mais. Se os dados do loop externo mostrarem que um limite está apertado demais, ele é aumentado, sempre por issue, como qualquer outra melhoria.

| Limite | Valor inicial | Onde é usado |
|--------|---------------|--------------|
| Voltas por issue | 3 | [Limite de voltas](04-linha-de-montagem.md#limite-de-voltas) (loop interno) |
| Gerações de melhoria | 2 | [Limite de gerações de melhoria](05-auto-melhoria.md#limite-de-gerações-de-melhoria) (loop externo) |

## Seguro

Segurança vem **em primeiro lugar** em toda decisão de implementação. Uma solução mais barata ou mais simples não é escolhida se for menos segura.

## Autônomo e visível

A fábrica precisa **funcionar sem o humano**, o máximo possível. Mas ela **não pode ser uma caixa preta**.

- **Visibilidade**: um humano pode ver, a qualquer momento, o que está acontecendo: o que está em andamento, em que etapa, o que está parado e por quê.
- **Comunicação**: quando precisa do humano, a fábrica **notifica**. Ela não espera que alguém perceba sozinho.

Os casos em que a fábrica chama o humano estão em [Humano e visibilidade](08-humano-e-visibilidade.md).

## Critérios de decisão

Quando houver mais de uma forma de implementar, a escolha segue esta ordem de prioridade:

1. **Segurança**: a opção mais segura.
2. **Custo financeiro**: a opção que não exige (ou exige menos) assinatura, plano ou pagamento de algum serviço.
3. **Manutenibilidade**: a opção mais fácil de manter e evoluir.

> **Custo aqui é dinheiro**, não esforço. Dias de trabalho e consumo de tokens **não** entram como critério de escolha da solução. Esse custo operacional é tratado pelo loop externo, que otimiza a fábrica.
