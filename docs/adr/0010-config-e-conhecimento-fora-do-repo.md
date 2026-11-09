# Config de projeto e conhecimento ficam fora do repositório

> **Atualização (ADR-0016):** projetos de repositório GitHub também podem ser criados pela interface, guardados no estado
> durável. O YAML continua aceito e tem prioridade sobre um projeto criado pela interface com o mesmo nome.


As configs de projeto (`~/.config/software-factory/projects/*.yaml`) e o conhecimento de cada projeto (`projects/<projeto>/knowledge.md`, `review-standards.md`) ficam fora deste repositório, porque contêm dados do projeto corporativo (pessoas, repositórios, ambientes). O repositório guarda só o schema e um `projects/example.yaml`. As propostas de retrô sobre o conhecimento de um projeto alteram esses arquivos locais, e só depois da aprovação do usuário.
