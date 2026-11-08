# Redesign da central de trabalho

## Direção

Interface inspirada na clareza e densidade do Linear, preservando HTML/CSS/JS nativo, CSP, API e aprovações existentes. Paleta neutra com destaque violeta, estados com cores semânticas, temas conforme preferência do sistema.

## Componentes novos

| Componente | Comportamento |
| --- | --- |
| Visão geral | Métricas globais: todas, aguardando você, em execução e bloqueadas |
| Métrica clicável | Filtra a lista ou quadro, com `aria-pressed` |
| Busca | Combina filtro com título/chave/projeto, ignorando acentos e caixa |
| Lista | Visualização inicial, pendências antes dos bloqueios e demais tarefas; encerradas ao final |
| Alternador Lista/Quadro | Mantém busca e filtro; quadro conserva as seis etapas |
| Contagem de resultados | Anuncia total visível e explica organização visual |
| Menu Configurações | Retira configurações de publicação da linha principal de ações |

A ordenação visual da lista não altera a fila durável. Os botões subir/descer continuam operando sobre a ordem real da fila, não sobre a busca. Métricas mostram totais globais, não só o resultado da busca. Estado "em execução" significa tarefa `ativa`; fila e pausas não são contadas como execução. "Aguardando você" reutiliza `cardHint`, evitando tratar espera por vaga como decisão humana.

Filtros, busca e modo ficam em memória durante a sessão da página; atualizações SSE preservam esses controles. Recarregar restaura a lista completa. O detalhe, suas seis abas, perguntas, revisões e publicações mantêm os contratos anteriores.

## Validação

- Testes unitários em `test/web-workspace.test.ts`: métricas, espera por vaga, busca combinada e ordenação sem mutar entrada.
- Smoke reproduzível: `node scripts/check-web-redesign.mjs` com daemon rodando e `playwright-cli` instalado. Usa navegador isolado e bloqueia POSTs. Não envia respostas, aprovações nem comandos de gestão.
- Verifica filtros, busca vazia, quadro com seis colunas, larguras 390/768/1440, abas, teclado e diálogo de configuração.
- Capturas reais da validação local: `/tmp/redesign-desktop.png`, `/tmp/redesign-mobile.png`, `/tmp/redesign-mobile-dark.png`.
- Evidências anotadas: `~/Downloads/e2e-factory-redesign-desktop.png` e `~/Downloads/e2e-factory-redesign-mobile.png`.

## Visão de implementação

A aba mostra situação atual, branch, envio ao remoto, tickets com commits RED/GREEN e até oito registros recentes de progresso/erro. A barra usa somente tickets com commit de implementação registrado; não indica review, CI ou merge aprovados. Sem registros, uma tarefa ativa na etapa de implementação informa que aguarda os primeiros registros, não que ainda não começou. Tickets planejados continuam visíveis mesmo sem branch persistida. Os eventos são registros da tarefa, não uma transmissão do terminal ou do raciocínio do modelo.

## Limites

Sem bibliotecas adicionais e sem migração de framework. O detalhe também foi refinado: navegação Voltar/Ações no topo, pipeline recolhido com etapa atual, triagem com justificativa expansível e estados explicativos para SPEC e Tickets vazios. O smoke cobre expansão do pipeline e menu de ações, além das abas. Não altera autenticação, proxy ou acesso via Tailscale: a URL móvel da fábrica ainda exige configuração separada. Viewport móvel não substitui teste em aparelho físico.
