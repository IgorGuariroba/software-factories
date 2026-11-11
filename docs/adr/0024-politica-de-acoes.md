# Política de ações: cada efeito externo resolve em executar, pedir prévia, só registrar ou proibir

**Estado:** aceita, não implementada. Plano: [fase 2](../plano-evolucao-arquitetura.md#fase-2-uma-decisão-por-efeito).

A ADR-0005 dizia que o merge é o único portão humano, mas o código ganhou prévias de pergunta, SPEC, baixa de triagem e publicação de retrô, cada uma com a própria chave de configuração, além do dry-run e dos guardrails. São a mesma decisão espalhada. Decidimos que todo efeito externo passa por um único ponto, que responde uma de quatro coisas: **executar**, **pedir prévia** (a Tarefa espera a aprovação do conteúdo exato), **só registrar** ou **proibir**. A resposta vem de uma política por projeto, com mínimos fixos no código. Substitui a [ADR-0005](0005-merge-e-o-unico-portao-humano.md).

- **Tipos de ação**: assumir o card, pergunta, SPEC e Tickets, baixa de triagem, código (push e PR/MR), publicação pública, aviso por Canal e ferramenta externa.
- **Mínimos que a configuração não rebaixa**: merge e push em branch protegida são sempre proibidos (ADR-0006); publicação pública sempre pede prévia; o card nunca passa de `Aguardando Teste`.
- **Dry-run** é a política em que tudo é só registrado.
- **A aprovação vale para um conteúdo.** Ela fica presa ao hash do conteúdo, ao destino e ao modo. Se algum deles muda, a prévia volta a pendente.
- **O modelo só aumenta a exigência.** Uma etapa pode pedir prévia onde a política diz executar (ex.: triagem duvidosa), nunca o contrário.

## Considered Options

- Manter uma chave por prévia (`specApproval`, `questionApproval`, `triageApproval`, `retroApproval`): rejeitado, porque cada ação nova cria outra chave e outro caminho de código para a mesma decisão.
- Capacidades emitidas a cada ação, por projeto, destino, operação e prazo: rejeitado. Num processo único, o ponto de checagem já é o escritor de efeitos, e um token não acrescenta controle.

## Consequências

- As chaves antigas continuam aceitas na leitura e viram política. A interface passa a mostrar a tabela de ações.
- O glossário deixa de dizer que o merge é o único Portão humano.
- A aprovação só vale o que vale a sessão da API (ADR-0023).
