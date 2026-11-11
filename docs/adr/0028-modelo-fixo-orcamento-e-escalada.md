# Modelo fixo por etapa, com orçamento por Tarefa e modelo de escalada

**Estado:** aceita, não implementada. Plano: [fase 4](../plano-evolucao-arquitetura.md#fase-4-custo-e-prova).

As ADR-0007, 0008 e 0011 descrevem seleção de modelo por classe e por cota, que não fazem parte do desenho atual: o modelo de cada etapa vem da configuração (ADR-0021). Em vez de construir roteamento, decidimos manter o modelo fixo por etapa e acrescentar dois limites simples. Retira das ADR-0007 e 0008 as regras de classe e de espera por cota, e deixa a ADR-0011 sem uso.

- **Orçamento por Tarefa**: tokens, tempo ativo e tentativas. Ao atingi-lo, a Tarefa para como bloqueada, com o gasto no motivo, e o usuário decide se aumenta.
- **Modelo de escalada**, opcional por etapa: depois de um número de recusas seguidas, a etapa troca uma única vez para ele. Só existe se o usuário o configurar, dentro dos provedores permitidos do projeto. Não é fallback.
- **Review de outra família** continua (ADR-0008), comparado com o modelo que de fato implementou, inclusive o de escalada. É uma defesa barata, não uma prova de qualidade.
- **A escolha continua do usuário.** A interface mostra, por modelo e etapa, recusas, rodadas de review, falhas de CI e correções pedidas por pessoas.
- **Limite do provedor** segue como hoje: aparece como erro, e a Tarefa volta à fila para nova tentativa.

## Considered Options

- Roteamento por avaliação (modelos avaliados por tipo de trabalho, escolhidos por risco, cota e custo): rejeitado. Exige um conjunto de casos e um volume que uma fábrica pessoal não tem, e prever a dificuldade pelo card é menos confiável do que observar as recusas.
- Implementar classe e cota como nas ADRs originais: rejeitado, porque o problema real era gasto sem limite, não escolha de provedor.

## Consequências

- `Classe` sai do glossário quando a fase entrar. `Cota` continua a ser só a do plano, sem leitura pela fábrica.
- O review precisa conhecer o modelo que de fato implementou, e não só o configurado.
