# Configuração de projeto editada pela interface; o YAML só semeia

Substitui a regra de prioridade da ADR-0016 (o YAML vence quando há nome igual) e a limitação de que a configuração avançada de repositório (caminho local e comando de teste) fica só no YAML. Mantém a ADR-0010 no que diz respeito a manter a configuração fora do repositório da fábrica.

- **Estado durável manda.** A configuração de cada projeto (Fonte, Canais por pessoa, Perfis, Pessoas do projeto, repositórios e provedores permitidos) é lida e gravada pela API de configuração no estado durável. A interface web é só um cliente dessa API.
- **YAML como semente.** Na primeira execução, cada projeto do YAML que não existe no estado durável é criado nele. Depois disso, o YAML não sobrescreve nenhum projeto que já esteja no estado, mesmo com nome igual. Mudanças no YAML de projetos já semeados não têm efeito.
- **Tudo editável pela interface.** Inclusive repositórios locais, com validação de que o caminho existe e de que o comando de teste é aceito.
- **Projetos novos nascem em dry-run.** O usuário desliga o dry-run pela interface.
- **Chaves antigas do YAML continuam válidas** para a semente, sem migração manual.
- **Histórico de alterações.** Toda gravação de configuração registra quem mudou e quando.

## Considered Options

- YAML como fonte da verdade, com a interface apenas gerando o arquivo: rejeitado, porque o usuário quer editar pela interface e não reiniciar o daemon para cada mudança.
- Dois lugares de escrita com YAML vencendo em conflito (regra da ADR-0016): rejeitado, porque deixa a interface sem efeito sobre projetos que também estão no YAML.
- Interface gravando de volta no YAML: rejeitado, porque reescrever o arquivo do usuário a partir da fábrica perde comentários e formatação, e mistura duas fontes de verdade no mesmo dado.

## Consequências

- A ADR-0016 deixa de descrever a prioridade atual e passa a apontar para esta.
- O YAML deixa de ser o lugar para ajustes de projeto depois da primeira execução. Quem quiser recriar um projeto a partir do YAML precisa removê-lo da interface antes.
- Ver também a [SPEC](../spec-configuracao-por-projeto.md).
