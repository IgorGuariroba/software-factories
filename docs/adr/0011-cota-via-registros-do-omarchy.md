# A cota vem dos registros de uso do Omarchy, atrás de uma interface `QuotaSource`

Os provedores não oferecem uma API oficial e estável de cota de assinatura. Por isso a implementação padrão lê os registros que o Omarchy já mantém em `~/.local/state/omarchy/agents/usage/<id>.json` (`limits[]` com `percent` e `resetsAt`, `limitsStale`, `retryAdvised`), conforme o contrato em `/usr/share/omarchy/docs/agent-usage-collectors.md`, em vez de chamarmos endpoints não oficiais dos provedores. A interface `QuotaSource` mantém a fábrica portável para fora do Omarchy (ex.: VM).
