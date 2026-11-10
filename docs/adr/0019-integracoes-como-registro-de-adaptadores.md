# Integrações como adaptadores registrados no código, com schema próprio

Fontes de demanda e Canais são adaptadores que implementam as portas já existentes (`DemandSource` e `Channel`) e se registram por um nome de tipo (ex.: `jira`, `github`, `gitlab`, `teams`, `card-comment`). A configuração de um projeto referencia o tipo pelo nome.

- **Registro em código.** Um tipo novo é um arquivo com a implementação e um registro. Não há carregamento dinâmico de módulos externos.
- **Cada adaptador declara o próprio schema de configuração.** A interface gera o formulário a partir do schema, sem tela específica por integração.
- **Validação pelo schema.** A API valida a configuração contra o schema do tipo antes de gravar.
- **Seleção pela interface.** O usuário escolhe, na interface, entre os tipos registrados. Tipos não registrados não aparecem.
- **Interface de gestão fora do registro.** O Telegram é configurado globalmente e não é um tipo de Canal.
- **Fonte única por projeto.** Várias Fontes simultâneas ficam para depois, porque quebrariam o prefixo das chaves das tarefas.

## Considered Options

- Carregamento dinâmico de plugins de um diretório de configuração: rejeitado, porque hoje o código não tem superfície de plugin e o carregamento de código de terceiros exigiria controle de segurança que não está no escopo.
- Uma tela específica para cada integração: rejeitado, porque cada integração nova exigiria mudar a interface, e o objetivo é acrescentar integrações sem isso.
- Uma única classe com ramos por tipo: rejeitado, porque mistura as regras de todas as integrações e impede testar cada uma pelo contrato da porta.

## Consequências

- Acrescentar um tipo exige uma mudança no código e um novo release, não só uma configuração.
- O núcleo da fábrica depende só das portas, então um tipo novo não altera a regra de triagem, de perguntas ou de escalonamento.
- Ver também a [SPEC](../spec-configuracao-por-projeto.md) e a [ADR-0018](0018-armazenamento-de-configuracao-e-segredos-por-portas.md).
