# Configuração e segredos atrás de portas: ConfigStore e SecretStore

A configuração de projeto e as credenciais ficam atrás de duas portas com implementação trocável, para que a API e a interface não dependam de SQLite nem do cofre em disco.

- **ConfigStore**: lê e grava a configuração de projeto, a configuração global do usuário (bot e chat do Telegram) e o histórico de alterações. Implementação desta entrega: estado durável (SQLite).
- **SecretStore**: grava credenciais, verifica se existem e lista nomes e datas. Não devolve o valor para a interface nem para a API. Implementação desta entrega: cofre próprio em disco, com AES-256-GCM. A chave fica em arquivo com permissão 0600, criado na primeira gravação.
- **A configuração guarda só o nome da credencial.** Nenhum segredo entra no `ConfigStore`, nem em texto puro, nem cifrado.
- **Validação antes de salvar.** A API valida a credencial e a conexão com a Fonte ou o Canal antes de gravar a referência. O valor é gravado no `SecretStore` e nunca volta para a tela depois de salvo.
- **API como única porta de escrita.** Qualquer interface (web ou outra) grava pela API, que aplica as mesmas validações.

## Considered Options

- Segredos no estado durável, com cifragem própria: rejeitado, porque o projeto não tem cofre de segredos reaproveitável. A ADR-0003 trata das credenciais do usuário, não de uma ferramenta de cifragem.
- Configuração em arquivo separado no lugar do SQLite: rejeitado, porque o estado durável já é o lugar de gravação atômica e o usuário já o usa para o projeto criado pela interface (ADR-0016).
- Portas sem implementação trocável, acopladas diretamente ao SQLite e ao cofre em disco: rejeitado, porque impede testes com fakes, que é a estratégia de teste da SPEC.

## Consequências

- Nenhum valor de segredo sai pela API ou pela interface; só o código da fábrica lê o cofre.
- Trocar o armazenamento de configuração não muda a API nem a interface.
- Ver também a [SPEC](../spec-configuracao-por-projeto.md) e a [ADR-0017](0017-configuracao-de-projeto-editada-pela-interface.md).

> **Correção:** uma versão anterior desta ADR dizia que o SecretStore usaria o "age" já existente. Não há cofre age no
> projeto: a palavra na ADR-0003 é o verbo português ("a fábrica age com as credenciais do usuário"). O cofre é o descrito
> acima.
