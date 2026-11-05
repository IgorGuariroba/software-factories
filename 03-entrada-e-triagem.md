# Entrada e triagem

[← Índice](index.md)

## Entrada da demanda

Toda demanda entra na fábrica pela **issue do GitHub** do projeto que a fábrica está cuidando. A issue é a única porta de entrada: o que não está numa issue não entra na linha de montagem.

Receber a issue **não significa aceitá-la**. A issue é um ponto de fragilidade: qualquer pessoa pode escrever nela, inclusive um prompt malicioso. Por isso toda issue passa pela [triagem](#triagem) antes de qualquer trabalho.

### Conexão via GitHub App

A fábrica é um **GitHub App**. Para colocar um projeto na fábrica, basta instalar o app no repositório:

1. Instalo o app da fábrica no repositório do projeto X.
2. A partir daí, toda issue nova no projeto X é recebida pela fábrica automaticamente e vai para a triagem.
3. Se passar na triagem, a fábrica trabalha na issue sem nenhuma ação minha.

Tirar um projeto da fábrica é só desinstalar o app do repositório.


## Triagem

A triagem decide se a issue entra na fábrica e define exatamente o que vai ser feito. Ela tem três passos, nesta ordem:

### 1. Segurança

A segurança avalia a issue antes de qualquer outro agente trabalhar nela. O objetivo é barrar:

- **prompt injection**;
- um **pedido malicioso**, que tenta fazer a fábrica executar algo indevido.

A verificação tem duas camadas:

| Camada | Como funciona |
|--------|---------------|
| **1. Lista de padrões conhecidos** | Uma lista dos argumentos e padrões já identificados como prompt injection. Se a issue bate com a lista, é rejeitada sem gastar modelo. A lista é mantida pelo loop externo e editada por mim (ver abaixo). |
| **2. Juiz de segurança (Jev)** | Um modelo de julgamento rápido e barato avalia a issue e responde se ela tem prompt injection ou pedido malicioso. |

O juiz é um **modelo diferente** dos agentes que trabalham na issue. Assim, um prompt feito para enganar os agentes não engana o juiz pelo mesmo caminho.

> **Decisão: Jev**, modelo de decisão (sim/não, múltipla escolha, nota) da TypeSafe, acessado por API.
>
> A alternativa considerada foi o [jevos](https://github.com/feder-cr/jev), open-source (licença MIT), que roda localmente em CPU e é gratuito. Escolhemos o Jev porque é mais preciso (segundo o benchmark do próprio jevos) e, pelos [critérios de decisão](01-principios.md#critérios-de-decisão), **segurança vem antes de custo**.
>
> **Preço e desempenho** (provedor TypeSafe):
>
> | Input | Output | Latência (P50) | Uptime |
> |-------|--------|----------------|--------|
> | US$ 0,042 / milhão de tokens | grátis | 0,08 s | 100% |
>
> Estimativa: uma issue de ~2 mil tokens custa cerca de US$ 0,00008. Mil issues custam cerca de US$ 0,08. O custo é por uso, sem assinatura.

### Issue insegura

Se qualquer camada considerar a issue insegura:

1. A issue é fechada como `not planned` e recebe a label `fabrica:rejeitada-seguranca`.
2. A conversa é **travada** (*lock*, motivo `spam`), para impedir novas tentativas nos comentários.
3. O **autor é bloqueado**: a fábrica não recebe mais issues de quem tentou atacá-la.
4. Ninguém é avisado.

### Manutenção da lista de padrões

A lista de padrões conhecidos cresce de duas formas:

- **Pelo loop externo**: cada padrão novo que o juiz de segurança pegar é adicionado à lista. Assim, a próxima tentativa igual é barrada na primeira camada, sem gastar modelo.
- **Por mim**: como autor da fábrica, posso adicionar, alterar ou remover padrões.

### Falso positivo

Como ninguém é avisado da rejeição, quem identifica um falso positivo sou eu, como autor da fábrica.

**Como marcar:** coloco a label `fabrica:falso-positivo` na issue rejeitada.

**Verificação de quem marcou:** a fábrica não confia só na label, confere quem a colocou.

1. Quando uma label é adicionada, o GitHub avisa a fábrica e informa quem fez a ação (campo `sender`).
2. A fábrica só aceita a label se quem a colocou estiver numa **allowlist**, comparada pelo **ID numérico** do usuário (o ID não muda; o login pode ser trocado).
3. Se outra pessoa colocar a label, a fábrica remove a label, não faz mais nada e registra a tentativa para o loop externo.

Por que label, e não outra forma:

- Só quem tem permissão de *triage* ou acima no repositório consegue colocar label. Um usuário de fora não consegue.
- A fábrica não precisa ler texto livre. Um comando em comentário (ex.: `/falso-positivo`) seria mais uma porta para prompt injection.
- Não exige construir um painel separado ([menor escopo](01-principios.md#mínimo)).

**O que a fábrica faz** quando a marcação é válida:

1. Reabre a issue, destrava a conversa e remove a label `fabrica:rejeitada-seguranca`.
2. Desbloqueia o autor.
3. Manda a issue de volta para a triagem, pulando o passo de segurança.
4. Leva o caso para o loop externo, que corrige a causa: remove ou ajusta o padrão da lista ou registra o erro do juiz.

A segurança é o primeiro passo porque é a [primeira prioridade da fábrica](01-principios.md#seguro): o conteúdo da issue não deve chegar aos outros agentes antes de ser verificado.

A verificação vale para **toda** entrada, sem exceção:

- issues abertas por pessoas;
- issues abertas pela própria fábrica (melhorias do loop externo), que podem carregar trechos de uma issue original maliciosa;
- comentários nas issues, porque qualquer pessoa pode comentar e incluir um trecho malicioso.

### 2. Duplicação e conflito

A triagem verifica se a issue:

- **é duplicada**: já existe outra issue sobre o mesmo problema (às vezes chega mais de uma issue com o mesmo problema);
- **já foi resolvida**: o problema já tem solução;
- **conflita com trabalho em andamento**: a fábrica já está trabalhando numa solução que cobre a issue nova.

Em qualquer desses casos, a issue não abre uma nova frente de trabalho.

### 3. Alinhamento e especificação

Com a issue aprovada, dois agentes definem o escopo da tarefa usando `grilling` (produto novo) ou `grill-with-docs` (produto existente). O alinhamento é feito **entre os dois agentes**, porque se o `grill` dependesse de mim para responder, toda issue ficaria parada esperando:

- **Agente questionador**: levanta as causas, as perguntas e as alternativas de implementação.
- **Agente decisor**: escolhe a melhor opção para cada ponto, dentro do menor escopo e seguindo os [critérios de decisão](01-principios.md#critérios-de-decisão).

Depois do alinhamento:

- `to-spec` gera a spec da tarefa;
- `to-tickets` separa a spec nos cards que vão ser implementados.

Com os tickets prontos, a issue sai da triagem e vai para a implementação.

## Questões em aberto

- Onde fica a allowlist de usuários autorizados (configuração da fábrica, variável de ambiente)? Ela vale para todos os projetos ou é por projeto?
- Onde fica a lista de padrões para eu editar (arquivo no repositório da fábrica, painel)?
- Bloquear o autor vale para um repositório, para a organização ou para todos os projetos da fábrica?
- A triagem também barra issues que não são pedido de trabalho (perguntas, discussões)?
- O que uma issue precisa ter para ser aceita na fábrica (template, critérios mínimos)?
- Quando a issue nova cobre algo já em andamento, ela espera, é anexada ao trabalho atual ou é descartada?
- O que acontece quando os dois agentes da triagem não chegam a uma decisão: a issue sobe para mim?
- A lista de padrões de prompt injection também muda só por issue, ou o loop externo continua adicionando padrões direto (para barrar o ataque seguinte mais rápido)?
- O que acontece com um comentário malicioso numa issue legítima: só o comentário é ocultado ou a issue inteira é travada?
