# Projeto com um repositório e Fonte independente, todo configurável pela interface

Um projeto tem exatamente um repositório, que é clonado pela fábrica em diretório gerenciado, e uma Fonte escolhida na criação, que pode ser outro sistema (ex.: Jira com código no GitLab). Um mesmo repositório pode servir a mais de um projeto, desde que não compartilhe a Fonte de issues. Para ficar ativo, o projeto precisa de repositório, Fonte, PO, tech lead, um Canal com identificador de cada pessoa que o usa, comando de teste e provedor permitido (comando de formatação é opcional); sem isso ele fica incompleto e não executa. Começa em ensaio ou execução conforme escolha do usuário na criação, com horário padrão `business-hours`, e nasce com identificadores validados contra os sistemas ao salvar.

Esta decisão substitui partes da [ADR-0016](0016-projetos-github-criados-pela-interface.md): a recusa de repositório repetido (agora só quando a Fonte de issues é a mesma), a Fonte fixa em GitHub Issues, o PO como dono do repositório, o ensaio obrigatório na criação e a ausência de remoção. Todas essas configurações, inclusive a remoção, ficam disponíveis na interface, conforme a [ADR-0017](0017-configuracao-de-projeto-editada-pela-interface.md); o YAML não precisa ser editado para nenhuma delas.

## Considered Options

- Vários repositórios por projeto, com a fábrica escolhendo onde trabalhar a cada demanda: rejeitado, porque a fila e a aprovação de cada demanda ficariam ambíguas.
- Fonte sempre igual ao repositório: rejeitado, porque projetos com Jira e código no GitLab ficariam sem caminho.
- Projeto ativo sem PO ou tech lead, ou sem comando de teste: rejeitado, porque a fábrica ficaria esperando uma pessoa ou um teste que nunca chegam, sem aviso.

## Consequências

- Projetos existentes que não cumprem essas regras (ex.: o `sf`, sem tech lead) passam a incompletos e aparecem na interface com a lista do que falta, em vez de continuarem ativos.
- Ao trocar Fonte ou repositório, o projeto só muda se não houver tarefas em andamento, e volta a incompleto até o usuário confirmar a nova configuração.
- A remoção mantém o histórico das tarefas concluídas, e o prefixo do projeto removido fica reservado enquanto esse histórico existir.
