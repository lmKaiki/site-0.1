# site-0.1

**Nexo** — plataforma de comunidades e comunicação (protótipo front-end completo).

## Rodando

Não há build nem dependências. Basta servir a pasta por HTTP:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\serve.ps1 -Port 8087
# abra http://localhost:8087/
```

Conta demo: `demo@nexo.chat` / `nexo123`.

## Estrutura

```
index.html        shell da aplicação + ordem dos scripts
css/              tokens, layout, componentes, landing, settings
js/
  core.js         utilitários, permissões, sessão, temas
  icons.js        ícones SVG próprios
  store.js        estado + seletores + permissões (fonte de verdade)
  seed.js         dados de demonstração
  api.js          camada de mutações (ponto de integração com backend)
  ui.js           primitivas de UI (modal, menu, toast)
  views.js        rail, sidebar, header, chat, membros
  pages.js        login, cadastro, home, perfil, convite
  modals.js       diálogos e menus
  app.js          roteador + bootstrap
```
