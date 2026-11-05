# Memória de problemas conhecidos

[← Índice](index.md)

O propósito da memória é **não tropeçar no mesmo erro várias vezes** quando ele já foi resolvido em um loop anterior. A fábrica guarda o que já sabe sobre cada problema numa **memória de problemas conhecidos**.

**A memória guarda problemas estruturais, do processo de fabricação, e não bugs do produto.**

| | Exemplo |
|---|--------|
| **Não vai para a memória** | "A página de login tem um erro." Isso é um bug do produto, que vira issue e é corrigido. |
| **Vai para a memória** | "Toda vez que corrigimos algo no login, temos dificuldade em criar o cenário de teste. O caminho que funciona é X." |
| **Vai para a memória** | "A skill Y sempre dá problema neste repositório quando faz a ação Z. Já foi contornado assim, e a issue W foi publicada." |

Quando um mesmo caminho já foi descoberto algumas vezes, ele pode deixar de ser só memória e virar **skill ou regra do molde**, o "caminho das pedras" para o agente não tropeçar de novo. Como é mudança no molde, ela é [feita direto, sem issue](05-auto-melhoria.md#toda-melhoria-vira-issue).

A memória fica **no repositório do projeto**, como parte do molde. Cada produto tem as suas peculiaridades: os problemas que a fábrica encontra ao fabricar aquele produto pertencem a ele.

O formato é **OKF (Open Knowledge Format)**, a especificação aberta do Google Cloud: uma árvore de arquivos Markdown com frontmatter YAML, versionada em Git.

Cada problema conhecido registra:

- **o problema**: sintoma, mensagem de erro, como reconhecer;
- **o caminho que funciona**: como o problema já foi resolvido ou contornado em loops anteriores;
- **o componente**, quando houver: skill, extensão, tool ou plugin onde ele acontece, a versão e se é de terceiros ou da fábrica;
- **a issue publicada**, quando houver: link da issue aberta no repositório do componente e o que ela pede para resolver.

Como a memória é usada:

1. **Quando um erro acontece**, o agente consulta a memória antes de investigar. Se o erro já é conhecido, ele segue o caminho que funciona em vez de gastar turnos redescobrindo o problema.
2. **Antes de abrir uma issue de melhoria**, o loop externo consulta a memória. Se o problema já tem issue registrada, ele **não publica de novo**. Isso evita postar a mesma issue sempre que o problema aparece.
3. **Problema que não está na memória**: o agente publicador [procura no repositório do componente](05-auto-melhoria.md#toda-melhoria-vira-issue) se já existe issue. Só publica se não existir. Nos dois casos, registra o problema e o link da issue na memória.

Exemplo de registro: *"já aconteceu o problema X na extensão Y; foi publicada a issue Z pedindo para resolver W; aguardamos a solução. Enquanto isso, é um problema conhecido e o caminho que funciona é V."*

A diferença entre os dois tipos de componente:

| Componente | Status do problema |
|------------|--------------------|
| **De terceiros** | Desconhecido. Como [não acompanhamos](05-auto-melhoria.md#toda-melhoria-vira-issue) a issue publicada, a memória só garante que o problema é conhecido e que a issue já existe. |
| **Da fábrica** | Conhecido. A issue passa pelo loop interno, então dá para saber quando ela foi resolvida (PR com merge) e atualizar o registro na memória. |

## Questões em aberto

- Quando um problema conhecido deixa de ser conhecido? Ex.: o erro não aparece mais depois de atualizar o componente, então o registro sai da memória.
- Quantas vezes um mesmo caminho precisa aparecer na memória para virar skill ou regra do molde?
