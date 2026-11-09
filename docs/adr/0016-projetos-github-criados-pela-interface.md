# Projetos de repositório GitHub criados pela interface

Substitui parcialmente o ADR-0010 (projetos vêm do YAML), só no ponto de criar projeto de repositório GitHub. Os demais
pontos do 0010 seguem valendo: a configuração e o conhecimento ficam fora do repositório da fábrica, e o YAML continua
aceito.

- **Criação pela página Repositórios**: o usuário escolhe um repositório do catálogo do GitHub App (`POST /projetos/github`)
  e informa nome e prefixo das chaves. Não há edição de arquivo nem reinício para o projeto entrar.
- **Padrões do YAML**: modelos (`roles`), estados (`statuses`) e o PO vêm do primeiro projeto de repositório do YAML (ou do
  primeiro projeto, se não houver nenhum de repositório). A interface não escolhe modelo nesta fase.
- **Ensaio por padrão**: o projeto nasce com `dryRun: true`. A fábrica só registra as escritas até o usuário desligá-lo.
  Desligar o ensaio ainda exige editar a configuração; a interface não faz isso nesta fase.
- **Guardado no estado durável** (`projetosGitHub`, como JSON validado a cada leitura). No startup, esses projetos entram
  junto com os do YAML.
- **O YAML tem prioridade**: um nome igual ao de um projeto do YAML é recusado na criação. Um prefixo de card já usado ou
  um repositório já monitorado também são recusados, porque colidiriam nas chaves das Tarefas ou duplicariam a fila.
- **Mesmo caminho dos demais**: o projeto criado recebe a mesma Fonte, o mesmo escritor e o mesmo lugar de conhecimento
  (`<configDir>/<projeto>/knowledge.md`) que os do YAML.

## Consequências

- Um projeto criado pela interface não tem a configuração avançada do YAML (ex.: `repositories` com caminho local e
  comando de teste). Essa configuração continua no YAML, e o projeto precisa dela para executar código de fato.
- Não há remoção de projeto pela interface nesta fase. Desplugar (ADR-0015) continua sendo o caminho para parar um repositório.
- Mover o projeto criado para o YAML é manual: copie a configuração e remova o registro do estado.
