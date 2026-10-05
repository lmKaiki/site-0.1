# E-mail da Nexo — configuração, entregabilidade e testes

> **Este documento não contém credenciais reais.** Todo valor de exemplo usa
> placeholders como `SEU_SECRET_AQUI`. Nenhuma chave pode ser copiada para o
> frontend, para o repositório ou para logs.

---

## 1. Arquitetura (o que faz o e-mail sair)

```
NAVEGADOR (js/providers.js)
   │  POST /api/send-email   { to, name, purpose, code }
   │  ← sem chave nenhuma aqui
   ▼
API SERVERLESS (api/send-email.js)          ← chave da API fica SÓ aqui
   │  monta assunto + corpo + remetente
   │  chama o provedor
   ▼
PROVEDOR (Resend ou Brevo)
   │  aceita ou recusa o envio
   ▼
GMAIL DO USUÁRIO  (Inbox · Spam · Promoções · outras pastas)
```

O navegador **nunca** fala com o provedor. Quem conhece a chave é a função
serverless (produção) ou o `serve.ps1` (local).

---

## 2. Conceitos: `accepted` ≠ `delivered`

| Sinalificado | Quando acontece | Quem pode afirmar |
|---|---|---|
| `accepted: true` | o **provedor aceitou** o pedido de envio (HTTP 200 da API dele) | a nossa API |
| `delivered: false` | o e-mail **chegou na caixa** do usuário | **ninguém aqui** — só o provedor/Gmail |
| falha | provedor recusou (chave inválida, domínio não verificado, limite) | a nossa API |

**Regra do produto:** a interface só declara “enviamos…” quando recebe
`{ ok: true }`. A mensagem exibida é:

> **Enviamos um código de verificação para seu e-mail. Verifique também Spam ou outras pastas.**

Nunca escrevemos “e-mail entregue”, “recebido na caixa de entrada” ou
“chegou no Inbox”. Se o provedor recusar, mostramos:

> **Não foi possível enviar o código. Tente novamente.**

Se não houver provedor configurado (`501 not-configured`), mostramos a
mensagem honesta de que **nenhum e-mail foi enviado**.

---

## 3. Variáveis de ambiente

| Variável | Obrigatória | Exemplo |
|---|---|---|
| `EMAIL_PROVIDER` | não (padrão `resend`) | `resend` ou `brevo` |
| `EMAIL_PROVIDER_API_KEY` | **sim** | `SEU_SECRET_AQUI` |
| `EMAIL_FROM` | **sim** | `codigo@seudominio.com` |
| `EMAIL_FROM_NAME` | não (padrão `Segurança da Nexo`) | `Segurança da Nexo` |
| `EMAIL_REPLY_TO` | não | `suporte@seudominio.com` |

Leitura:
- **local** → variável de ambiente do processo **ou** arquivo `.env`
  (o `.env` é ignorado pelo git e o servidor se recusa a servi-lo);
- **Vercel** → *Project → Settings → Environment Variables*.

`.env.example` (na raiz) mostra o formato. Preencha assim:

```env
EMAIL_PROVIDER=resend
EMAIL_PROVIDER_API_KEY=SEU_SECRET_AQUI
EMAIL_FROM=codigo@seudominio.com
EMAIL_FROM_NAME=Segurança da Nexo
```

---

## 4. Domínio da Nexo e remetente autenticado

Para parecer oficial (e não cair em Spam) o remetente precisa ser **do seu
domínio**, nunca `gmail.com`.

1. Compre/use um domínio (ex.: `seudominio.com`).
2. Crie um subdomínio só de e-mail transacional, ex.: `mail.seudominio.com`
   (mantém o domínio principal limpo).
3. `EMAIL_FROM=codigo@mail.seudominio.com`.
4. `EMAIL_FROM_NAME=Segurança da Nexo` (identidade exibida no Gmail).

### Resend (padrão)

1. <https://resend.com> → **Create API Key** → copie a chave (`SEU_SECRET_AQUI`).
2. **Domains → Add Domain** → informe `mail.seudominio.com`.
3. O Resend mostra os registros DNS a criar no seu provedor de DNS.
4. Voltar em **Domains → Verify**. Status precisa ficar **Verified**.

### Brevo (alternativa)

1. <https://app.brevo.com> → **SMTP & API → SMTP** → gerar chave.
2. `EMAIL_PROVIDER=brevo` e `EMAIL_PROVIDER_API_KEY=SEU_SECRET_AQUI`.
3. Em **Senders** adicionar e verificar `codigo@mail.seudominio.com`.

---

## 5. SPF, DKIM e DMARC (obrigatório para reduzir Spam)

Crie estes registros **no DNS do domínio que aparece em `EMAIL_FROM`**
(painel do provedor de DNS: Registro.br, Cloudflare, GoDaddy…):

### SPF

```
Tipo:  TXT
Nome:  mail.seudominio.com     (ou @ no domínio raiz)
Valor: v=spf1 include:amazonses.com ~all        ← Resend
       v=spf1 include:spf.brevo.com ~all        ← Brevo
TTL:   3600
```

O valor exato é gerado pelo provedor na tela de verificação do domínio —
**sempre use o que o provedor exibir**.

### DKIM

```
Tipo:  CNAME  (ou TXT, dependendo do provedor)
Nome:  resend._domainkey.mail.seudominio.com
Valor: <hash fornecido pelo Resend>
```

O Resend entrega como registros `CNAME` prontos (2 registros). Depois de
criar, clique em **Verify DNS Records**.

### DMARC

```
Tipo:  TXT
Nome:  _dmarc.seudominio.com
Valor: v=DMARC1; p=quarantine; rua=mailto:dmarc@seudominio.com; pct=100
TTL:   3600
```

Evolução recomendada:

| Fase | Política |
|---|---|
| 1 (começo) | `p=none` + relatórios → monitorar |
| 2 (1–2 semanas sem problemas) | `p=quarantine; pct=25` → subindo |
| 3 (estável) | `p=quarantine; pct=100` (ou `p=reject` se tudo for seu) |

Checklists rápidos: <https://learndmarc.com> e <https://mail-tester.com>
(envie o teste real e veja a nota de 0–10).

---

## 6. Teste de envio

### 6.1 Sem provedor configurado (deve falhar honestamente)

```powershell
Invoke-WebRequest -Uri http://localhost:8087/api/send-email -Method Post `
  -ContentType 'application/json' `
  -Body '{"to":"alguem@gmail.com","name":"Ana","purpose":"recover","code":"123456"}'
```

Resposta esperada: **501** `{"ok":false,"reason":"not-configured"}`.

### 6.2 Payload inválido

```powershell
Invoke-WebRequest -Uri http://localhost:8087/api/send-email -Method Post `
  -ContentType 'application/json' -Body '{"to":"x","code":"1"}'
```

Resposta esperada: **400** `{"ok":false,"reason":"invalid"}`.

### 6.3 Com chave configurada

Mesmo comando do 6.1 com `EMAIL_PROVIDER_API_KEY` preenchida:

- **200** `{"ok":true,"accepted":true,"delivered":false}` → o provedor aceitou;
- **502** `{"ok":false,"reason":"provider-error"}` → chave/domínio errado
  (o `detail` é gravado no log do servidor, **sem** a chave e **sem** o código);
- **429** `{"ok":false,"reason":"rate-limit"}` → mais de 4 envios para o
  mesmo endereço em 15 minutos.

### 6.4 Fluxo completo no produto

```
Recuperar acesso → informar e-mail → conta encontrada → código gerado
→ enviado pelo provedor → usuário olha Gmail (Inbox/Spam/Promoções)
→ informa o código → validação → nova senha → login
```

---

## 7. Teste no Gmail (Inbox, Spam, Promoções)

1. Envie para um Gmail real que você controle.
2. Abra o Gmail e procure em:
   - **Principal (Inbox)** — resultado normal;
   - **Spam** — se estiver aqui, leia o cabeçalho “por que estou vendo isto?”;
   - **Promoções** — comum quando o remetente é novo;
   - **Todas as mensagens / Outros** — alguns filtros do usuário.
3. Verifique o cabeçalho do e-mail recebido:
   - `From: Segurança da Nexo <codigo@mail.seudominio.com>`
   - `Subject: Seu código de recuperação` (ou `Seu código de verificação`)
4. Gmail → abrir a mensagem → **mostrar cabeçalho original** confere:
   - `spf=PASS`, `dkim=PASS`, `dmarc=PASS`.

A interface **sempre** orienta a conferir as outras pastas — nunca prometemos
que o e-mail cai no Inbox.

---

## 8. Erros comuns

| Sintoma | Causa provável | Correção |
|---|---|---|
| `501 not-configured` | sem `EMAIL_PROVIDER_API_KEY` | definir variável de ambiente ou `.env` e reiniciar o servidor |
| `502 provider-error` (401) | chave inválida/revogada | gerar nova chave no provedor |
| `502 provider-error` (403/422) | domínio não verificado | concluir SPF/DKIM e clicar em Verify |
| cai sempre em Spam | domínio novo sem histórico, sem DMARC, remetente `gmail.com` | domínio verificado + DMARC + remetente do domínio + conteúdo simples |
| `From: no-reply@resend.dev` | `EMAIL_FROM` vazio | preencher `EMAIL_FROM` com o domínio verificado |
| `429 rate-limit` | testes repetidos no mesmo e-mail | esperar 15 min ou usar outro endereço |
| código não chega | está em **Spam/Promoções** | seguir a orientação exibida na tela |
| `403 forbidden` ao abrir `.env` | o servidor bloqueia arquivos sensíveis | esperado — a chave só sai pelo ambiente do servidor |

---

## 9. Regras inegociáveis

1. **Nenhuma** senha, chave, token ou segredo no frontend.
2. O código de verificação **nunca** aparece na interface nem no `console`
   (nem em produção nem em desenvolvimento).
3. Logs técnicos usam e-mail mascarado (`an***@gmail.com`) e nunca gravam o
   código.
4. O e-mail enviado **não contém links** — só o código, o aviso de expiração
   e a linha “Se você não solicitou…, ignore este e-mail”.
5. `accepted: true` **nunca** vira a frase “e-mail entregue”.
6. `.env` fica fora do git (`.gitignore`) e o servidor responde `403` para
   qualquer tentativa de baixá-lo.
