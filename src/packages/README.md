# Pacotes (módulos profundos)

Cada pasta filha de `src/packages/` é um **pacote**: muito comportamento atrás de uma interface pequena.

## Layout

```
src/packages/
  <nome>/
    index.ts        ← entry point (público). Importe a partir de fora.
    client.ts       ← outro entry point, se o pacote precisar de mais de um.
    lib/            ← implementação: privada, livre para importar a si mesma.
    tests/          ← testes do pacote e fixtures (também privados).
```

Modelo para copiar: [`example/`](./example/).

## Regras (verificadas por `npm run lint:boundaries`)

1. **Fronteira pelos entry points.** Código fora de um pacote importa apenas os arquivos da raiz dele, nunca as subpastas.
2. **Liberdade interna.** Arquivos de um mesmo pacote importam uns aos outros livremente.
3. **Testes pelos entry points.** `tests/` importa entry points de qualquer pacote e fixtures do próprio `tests/`, mas nunca internals de pacote (nem do próprio).
4. **Sem ciclos.** Nenhuma dependência circular.

## Evite barrels

Não crie um `index.ts` que reexporta uma subárvore inteira. Prefira vários entry points pequenos na raiz do pacote, e mantenha a implementação em subpastas.

## Como verificar

```sh
npm run lint:boundaries
```
