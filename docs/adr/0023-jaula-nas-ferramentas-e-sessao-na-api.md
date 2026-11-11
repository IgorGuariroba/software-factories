# A jaula fica nas ferramentas, cobre os testes, e a API exige sessão

**Estado:** aceita, não implementada. Plano: [fase 1](../plano-evolucao-arquitetura.md#fase-1-fechar-a-jaula).

O que a fábrica executa a pedido do modelo (comandos de shell, o código que ele escreveu e os testes desse código) não deve alcançar os arquivos nem a rede do usuário. Decidimos que toda execução pedida pelo modelo ou pela verificação da fábrica (shell, suíte de testes, formatador) roda na mesma jaula, e que a API exige uma sessão que a jaula não alcança. Completa a [ADR-0006](0006-guardrails-por-codigo-e-sandbox.md).

- **Raiz mínima.** A jaula monta `/usr`, o mínimo de `/etc`, o clone da Tarefa e temporários. A home do usuário, o cofre, o banco de estado e os outros clones ficam de fora. Ferramentas instaladas fora de `/usr` (ex.: pelo `mise`) entram por uma lista de caminhos só de leitura, por projeto.
- **Sem rede**. A instalação de dependências é um passo separado, com rede e sem segredos, que roda sobre o commit da base, antes de existir código do modelo.
- **Falha fechada.** Sem `bwrap`, o projeto fica incompleto. A fábrica não roda testes direto no host.
- **O que sai da jaula é o diff.** Antes do push, o diff passa pelo filtro de segredos, e um achado bloqueia a publicação.
- **Sessão na API.** Toda rota exige sessão, menos a saúde do daemon, o schema e a entrada. O segredo fica em arquivo `0600` no diretório de estado, fora da jaula. Processos do próprio usuário fora da jaula continuam confiáveis, porque já alcançam o banco.

## Considered Options

- Executores em processos separados, com imagem mínima e IPC com o daemon: rejeitado. O laço do agente vive no motor durável, que só um processo pode abrir (ADR-0001); movê-lo exigiria tunelar as chamadas de modelo e manter um segundo banco. O risco está no que as ferramentas executam, e é ali que a jaula fica.
- Manter o sistema inteiro legível e confiar na ausência de rede: rejeitado, porque o que o modelo lê vai para o provedor e pode ir parar num commit.
- Exigir sessão só nas rotas de aprovação: rejeitado, porque as leituras expõem SPEC, perguntas e configuração ao passo de instalação, que tem rede.

## Consequências

- Cada projeto pode precisar declarar caminhos de ferramentas. Sem eles, a suíte falha na jaula com "comando não encontrado".
- Testes que dependem de serviços do host (um banco local, por exemplo) deixam de alcançá-los.
- A suíte de testes da própria fábrica e qualquer script que use a API passam a abrir sessão.
