# Teams via Graph API, com fallback por acessibilidade (AT-SPI)

O canal Teams tenta primeiro a Microsoft Graph API com token delegado do usuário. Se o tenant não permitir, o fallback é o binário `agent-desktop`, que dirige o webapp do Teams por AT-SPI. Esse fallback exige abrir o Chromium com a flag de acessibilidade, porque no Hyprland/Wayland não há mouse sintético nem `focus-window`. A skill `computer-use` foi descartada porque só funciona em macOS/Windows. Até o M4, as perguntas vão como comentário no Jira, mencionando o PO.
