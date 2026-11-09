# Configurar publicações pela web

No topo da página, abra **Configurar publicações**. O mesmo formulário pode ser aberto por **Configurar repositório**, junto a uma proposta cuja revisão esteja indisponível por falta de destino.

Informe o repositório GitHub no formato `dono/nome` e clique em **Salvar configuração**. A escolha é global a todos os projetos, fica persistida no SQLite do daemon e é aplicada sem reinício. Ao iniciar, uma escolha salva pela web prevalece sobre `FACTORY_RETRO_REPO`; sem escolha salva, a variável continua sendo o valor inicial.

Salvar não publica issues, não retoma tarefas e não aprova propostas. Feche o formulário e clique novamente em **Revisar publicação pública**. Cada publicação ainda exige aprovação explícita da prévia, com as proteções existentes de privacidade e dry-run. Trocar o destino invalida a revisão feita para o destino anterior. Alterações de configuração são recusadas durante uma publicação.

O formulário configura somente o destino; não instala nem autentica o adaptador GitHub, não verifica se o repositório existe e não cria a label `retro`. A publicação usa o `gh` já autenticado no daemon e exige acesso ao repositório. O destino é tratado como público: revise sempre o texto.

## API local

- `GET /settings/retro`: `{ repo: string | null, available: boolean }`.
- `POST /settings/retro`: JSON `{ repo: "dono/nome" }`; devolve a configuração aplicada.
- Nome inválido: 400. Adaptador ausente ou operação concorrente: 409. Content-Type incorreto: 415.
- As mesmas proteções locais de Host e Origin da API se aplicam.

## Validação

`test/retro-settings.test.ts` cobre persistência, precedência após reinício, validação, Origin, aplicação imediata, invalidação de prévia e destino do escritor usando somente adaptadores fake. `node scripts/check-web-retro.cjs` cobre o formulário pelo Playwright CLI, com configuração interceptada no navegador e todas as demais escritas bloqueadas.
