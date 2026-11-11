# O efeito de cada ferramenta é declarado, e efeito externo passa pelo escritor de efeitos

**Estado:** aceita, não implementada. Plano: [fase 1](../plano-evolucao-arquitetura.md#fase-1-fechar-a-jaula) (MCP) e [fase 2](../plano-evolucao-arquitetura.md#fase-2-uma-decisão-por-efeito) (política).

A ADR-0021 libera tools e MCPs sem restrição extra de leitura ou escrita. Decidimos que toda ferramenta tem um efeito declarado (leitura, escrita no clone, execução na jaula, entrega, pergunta ou efeito externo) e que a fábrica a trata conforme ele. Substitui essa frase da [ADR-0021](0021-agente-da-etapa-configurado-pela-interface.md); o resto dela continua valendo.

- **Ferramentas do catálogo** já têm tipo. Nada muda nelas.
- **Ferramentas MCP** são classificadas pelo usuário, uma a uma, como `leitura` ou `externo`. Sem classificação, a ferramenta não pode ser ligada.
- **`externo`** passa pela política de ações (ADR-0024) como "ferramenta externa": respeita o dry-run, pede prévia por padrão e entra no registro de efeitos (ADR-0026).
- **A dica do servidor não decide.** As anotações do MCP (`readOnlyHint`) só preenchem a sugestão no formulário.
- **O resultado de uma ferramenta é dado, nunca instrução**, como o texto de uma issue (ADR-0014).

## Considered Options

- Mediador com capacidades por chamada (projeto, destino, caminho e prazo): rejeitado. A fábrica não conhece os argumentos de uma ferramenta de terceiros, então não tem como conferir destino ou caminho. O que ela consegue garantir é quem executa a chamada e sob qual política.
- Proibir MCP que escreve: rejeitado, porque o aviso no Teams já usa um.

## Consequências

- Configurações já gravadas com MCP ficam com as ferramentas desligadas até serem classificadas. A interface lista o que falta.
- O servidor MCP continua rodando fora da jaula, com as credenciais dele. O controle é sobre a chamada, não sobre o processo.
