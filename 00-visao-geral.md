# Visão geral

[← Índice](index.md)

## Objetivo

Entrar uma demanda e sair o produto pronto, **sem depender de ação minha**.

A fábrica deve entregar:

- **Rápido**: pouco tempo entre a demanda e a entrega.
- **Melhor**: com qualidade.
- **Com eficiência**: sem desperdício de esforço.
- **Barato**: com custo baixo por entrega.
- **A qualquer hora**: funciona o tempo todo (24/7).

### O problema de hoje

Hoje eu programo com um agente na linha de comando, mas sou eu quem inicia, acompanha e para o trabalho. Quando fecho o notebook ou desligo o computador, tudo para. A produção depende da minha presença.

### O que muda com a fábrica

O trabalho deixa de depender de mim e do meu computador. A fábrica roda sozinha, de forma contínua: recebe a demanda, executa e entrega.

## Fluxo

A fábrica funciona com **dois loops**:

1. **Loop interno (linha de montagem)**: entrega o que foi pedido.
2. **Loop externo (meta-engenharia / auto-melhoria)**: melhora a própria fábrica.

Detalhes de cada etapa estão nos tópicos do [índice](index.md).

### Loop interno: linha de montagem

O loop interno tem duas fases: **triagem** e **implementação**. Só o que passa pela triagem chega à implementação.

```
issue
  │
  ▼
TRIAGEM
  1. segurança ─────────────────────────────── ✗ ──▶ rejeitada
  │
  2. duplicada / já resolvida / em andamento ── ✗ ──▶ ligada à existente
  │
  3. grill (2 agentes) → to-spec → to-tickets
  │
  ▼
IMPLEMENTAÇÃO
  tdd → code-review → PR → CI → merge
   ↑        │               │
   └────────┴─ correção ────┘
  │
  ▼
retro ──▶ loop externo
```

## Questões em aberto

- Onde a fábrica roda se não for no meu computador (servidor, nuvem)?
- Como medir "rápido", "melhor" e "barato"?
