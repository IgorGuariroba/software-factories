# Documentação de domínio

Como as skills de engenharia devem consumir a documentação de domínio deste repo ao explorar o código.

## Antes de explorar, leia

- **`GLOSSARY.md`** na raiz do repo. Não há `GLOSSARY-MAP.md`, então o repo é single-context.
- **`docs/adr/`**: leia as ADRs que tocam a área em que você vai trabalhar.

Se algum desses arquivos não existir, siga em frente sem comentar. O `/domain-modeling` cria os arquivos sob demanda quando termos ou decisões são resolvidos.

## Estrutura

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-pi-durable-como-motor-de-tarefas.md
│   └── ...
└── src/
```

## Use o vocabulário do glossário

Quando sua saída nomear um conceito de domínio (título de issue, proposta de refatoração, hipótese, nome de teste), use o termo como definido em `GLOSSARY.md`. Não derive para sinônimos que o glossário desaconselha (`_Avoid_`).

Se o conceito que você precisa não está no glossário, isso é um sinal: ou você está inventando linguagem que o projeto não usa, ou há uma lacuna real a registrar com `/domain-modeling`.

## Sinalize conflitos com ADRs

Se sua saída contradizer uma ADR existente, diga isso explicitamente em vez de sobrescrever em silêncio:

> _Contradiz a ADR-0007 (…), mas vale reabrir porque…_
