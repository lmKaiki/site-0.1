# ============================================================
#  NEXO . publish (Git + GitHub -> Netlify)
#
#  Uso:
#    powershell -ExecutionPolicy Bypass -File scripts\publish.ps1 -Message "Nexo: melhorar login"
#
#  O que faz, nesta ordem:
#    1. mostra o status (alterados / novos / deletados)
#    2. bloqueia arquivos sensiveis (.env, chaves, tokens...)
#    3. nao cria commit vazio
#    4. git add -A
#    5. git commit -m "<mensagem>"
#    6. git fetch + checagem de divergencia (NUNCA usa --force)
#    7. git push origin main
#    8. mostra o resultado final
#
#  NAO contem senha, token ou credencial alguma:
#  a autenticacao vem do credential manager do Git.
# ============================================================

param(
  [Parameter(Mandatory = $true)]
  [string]$Message
)

$ErrorActionPreference = "Stop"

# --- localiza o git (Windows ou PATH) ---
$git = "C:\Program Files\Git\cmd\git.exe"
if (-not (Test-Path $git)) { $git = "git" }

# raiz do projeto (pasta acima de scripts\)
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Say($m) { Write-Host $m -ForegroundColor Cyan }
function Warn($m) { Write-Host $m -ForegroundColor Yellow }
function Bad($m) { Write-Host $m -ForegroundColor Red }
function Ok($m) { Write-Host $m -ForegroundColor Green }

# ------------------------------------------------------------
# 0) remote e branch corretos
# ------------------------------------------------------------
$remote = & $git config --get remote.origin.url
$branch = & $git rev-parse --abbrev-ref HEAD
if ($remote -notlike "*lmKaiki/site-0.1*") {
  Bad "ERRO: remote inesperado -> $remote"
  Bad "Esperado: https://github.com/lmKaiki/site-0.1.git"
  exit 1
}
if ($branch -ne "main") {
  Bad "ERRO: branch atual = $branch (esperado main). Nada foi enviado."
  exit 1
}
Say "remote : $remote"
Say "branch : $branch"

# ------------------------------------------------------------
# 1) mostra as alteracoes
# ------------------------------------------------------------
$status = & $git status --porcelain
if (-not $status) {
  Ok "Nada a commitar: working tree limpa. Nenhum commit vazio foi criado."
  exit 0
}
Say "--- alteracoes encontradas ---"
& $git status --short
Say "----------------------------"

# ------------------------------------------------------------
# 2) bloqueio de arquivos sensiveis
# ------------------------------------------------------------
$sensitive = $status | Where-Object {
  $_ -match '^\s*\S*\s+\S*' -and
  ($_ -match '\.env(\.|$)' -or $_ -match '(?i)secret|credential|passwd|password|\.pem$|\.key$|id_rsa|id_ed25519|netlify.*token')
}
if ($sensitive) {
  Bad "ERRO DE SEGURANCA: arquivo sensiveis detectados - NADA foi enviado:"
  $sensitive | ForEach-Object { Bad "   $_" }
  Bad "Remova-os do estagio (git rm --cached <arquivo>) e tente de novo."
  exit 1
}
Ok "nenhum arquivo sensiveis detectado"

# ------------------------------------------------------------
# 3) mensagem de commit clara
# ------------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($Message)) {
  Bad "ERRO: mensagem de commit vazia."
  exit 1
}
if ($Message -notlike "Nexo:*") {
  Warn "aviso: a mensagem nao comeca com 'Nexo:' (ex.: 'Nexo: adicionar chamadas de voz')"
}

# ------------------------------------------------------------
# 4) add
# ------------------------------------------------------------
& $git add -A
if ($LASTEXITCODE -ne 0) { Bad "ERRO no git add."; exit 1 }

# se depois do add nao restou nada, nao ha o que commitar
$staged = & $git diff --cached --name-only
if (-not $staged) {
  Ok "Nada estagiado apos o add. Nenhum commit vazio foi criado."
  exit 0
}

# ------------------------------------------------------------
# 5) commit
# ------------------------------------------------------------
& $git commit -m $Message
if ($LASTEXITCODE -ne 0) { Bad "ERRO no git commit. Alteracoes locais preservadas."; exit 1 }

# ------------------------------------------------------------
# 6) divergencia com o GitHub (sem force push, nunca)
# ------------------------------------------------------------
Say "verificando divergencia com origin/main..."
& $git fetch origin main
if ($LASTEXITCODE -ne 0) {
  Bad "ERRO no fetch (sem conexao ou sem acesso). Commit local PRESERVADO. Tente de novo."
  exit 1
}
$behind = & $git rev-list --count "HEAD..origin/main"
if ([int]$behind -gt 0) {
  Bad "CONFLITO: origin/main tem $behind commit(s) que voce nao tem."
  Bad "Nao vou usar force push. Resolva com:"
  Bad "   git pull --rebase origin main"
  Bad "   (resolva conflitos) e rode o script de novo."
  exit 1
}

# ------------------------------------------------------------
# 7) push
# ------------------------------------------------------------
& $git push origin main
if ($LASTEXITCODE -ne 0) {
  Bad "ERRO no push. Commit local PRESERVADO (nada foi perdido)."
  Bad "Rode o script de novo quando a conexao voltar."
  exit 1
}

# ------------------------------------------------------------
# 8) resultado final
# ------------------------------------------------------------
Ok "=== PUSH CONCLUIDO ==="
& $git status -sb
& $git log -1 --format="commit  %H%nautor   %an%nmensagem %s"
Ok "GitHub atualizado -> o Netlify detecta o push e publica automaticamente."
