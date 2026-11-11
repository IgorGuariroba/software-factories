# O tipo de mudança define a evidência exigida, e é conferido no diff

**Estado:** aceita, não implementada. Plano: [fase 4](../plano-evolucao-arquitetura.md#fase-4-custo-e-prova).

A fábrica exige o ciclo TDD (o teste que falha, depois o código) para todo ticket, e já precisou de caminhos especiais para correções atendidas por outro reparo, para não criar teste artificial nem commit vazio. Decidimos que a exigência depende do tipo de mudança da Tarefa, e que o tipo vale pelo que o diff toca, não pelo que o modelo declarou.

- **Três tipos**: documentação, comportamento e alto risco. A SPEC declara um.
- **Evidência mínima**: documentação pede suíte verde e review; comportamento pede o ciclo TDD de hoje; alto risco pede o de comportamento e prévia do PR/MR antes do push.
- **Conferência no diff.** Os caminhos alterados entre a base e o HEAD decidem o tipo efetivo, por regras do projeto. O diff só aumenta a exigência: código fora dos caminhos de documentação torna a mudança de comportamento, e caminhos sensíveis (migrações, CI, infraestrutura) a tornam de alto risco.
- **Uma evidência por HEAD.** A publicação exige um conjunto único (revisão da SPEC, base, HEAD, tipo, suíte, ciclos e review) do HEAD atual. Mudança de escopo, de base ou de código invalida o que dependia dela.

## Considered Options

- Planos de trabalho por dependência, propostos pelo modelo e validados pela fábrica: adiado. Os três tipos fixos cobrem o ganho imediato; composição livre aumenta estados e critérios de invalidação sem um caso que a peça.
- Repositório de artefatos com manifesto, hash e retenção: rejeitado, porque os commits do clone já são endereçados por conteúdo. Basta gravar na Tarefa os SHAs e os resultados.
- TDD para tudo: rejeitado, pelos testes artificiais que produz em mudanças sem comportamento.

## Consequências

- Um ticket só de documentação deixa de ter fase de teste e fase de implementação.
- O projeto ganha duas listas de caminhos (documentação e sensíveis), com padrões da fábrica.
- "Perfil" continua a ser a função de uma pessoa do projeto; o termo aqui é "tipo de mudança".
