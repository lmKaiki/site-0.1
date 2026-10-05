param([int]$Port = 8087)

# ============================================================
#  NEXO · servidor local (estático + API de e-mail)
#  http://localhost:8087/
#
#  POST /api/send-email  →  mesmo contrato da function da Vercel:
#     { to, name, purpose, code }
#     200 {ok:true}  ·  400 {ok:false,reason:"invalid"}
#     429 {ok:false,reason:"rate-limit"}
#     501 {ok:false,reason:"not-configured"}
#     502 {ok:false,reason:"provider-error"}
#
#  Credenciais vêm do arquivo .env (LADO DO SERVIDOR, gitignored).
#  Nada aqui é exposto ao navegador e o código nunca é logado.
# ============================================================

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$types = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.ico'  = 'image/x-icon'
  '.md'   = 'text/plain; charset=utf-8'
}

# ---------------- credenciais locais ----------------
$CFG = @{}
$envFile = Join-Path $root '.env'
if (Test-Path $envFile) {
  Get-Content $envFile -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith('#')) {
      $i = $line.IndexOf('=')
      if ($i -gt 0) {
        $k = $line.Substring(0, $i).Trim()
        $v = $line.Substring($i + 1).Trim().Trim('"').Trim("'")
        $CFG[$k] = $v
      }
    }
  }
}
function Get-Cfg([string]$Key, [string]$Fallback = '') {
  if ($CFG.ContainsKey($Key) -and $CFG[$Key]) { return $CFG[$Key] }
  return $Fallback
}

# limite por destinatário (janela de 15 min, melhor esforço)
$script:Hits = @{}
$RateLimit = 4
$RateWindowMs = 15 * 60 * 1000

function Test-RateLimit([string]$to) {
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $rec = $script:Hits[$to]
  if (-not $rec -or (($now - $rec.first) -gt $RateWindowMs)) {
    $script:Hits[$to] = @{ first = $now; count = 1 }
    return $true
  }
  $rec.count = $rec.count + 1
  return ($rec.count -le $RateLimit)
}

function Get-FromParts([string]$From) {
  $m = [regex]::Match($From, '^"?([^"<]+)"?\s*<([^>]+)>$')
  if ($m.Success) { return @{ name = $m.Groups[1].Value.Trim(); email = $m.Groups[2].Value.Trim() } }
  return @{ name = 'Nexo'; email = $From.Trim() }
}

function New-MailBody([string]$Name, [string]$Code, [string]$Purpose) {
  $nome = if ($Name) { $Name.Trim() } else { 'usuário' }
  $platform = 'NEXO'
  if ($Purpose -eq 'verify') {
    return "Olá, $nome.`n`nRecebemos uma solicitação para verificar o seu e-mail no $platform.`n`nSeu código de verificação é:`n`n$Code`n`nEsse código expira em alguns minutos.`n`nSe você não solicitou isso, ignore este e-mail.`n`nAtenciosamente,`n$platform"
  }
  return "Olá, $nome.`n`nRecebemos uma solicitação para recuperar sua conta.`n`nSeu código de verificação é:`n`n$Code`n`nEsse código expira em alguns minutos.`n`nSe você não solicitou essa recuperação, ignore este e-mail.`n`nAtenciosamente,`n$platform"
}

function Send-NexoMail([string]$To, [string]$Name, [string]$Purpose, [string]$Code) {
  $subject = if ($Purpose -eq 'verify') { 'Seu código de verificação' } else { 'Seu código de recuperação' }
  $bodyText = New-MailBody -Name $Name -Code $Code -Purpose $Purpose

  $apiKey = Get-Cfg 'EMAIL_PROVIDER_API_KEY'
  $fromRaw = Get-Cfg 'EMAIL_FROM' 'Nexo <codigo@nexo.local>'

  # 1) provedor remoto (mesmo caminho da produção)
  if ($apiKey) {
    $from = Get-FromParts $fromRaw
    $payload = @{
      from    = $from
      to      = @($To)
      subject = $subject
      text    = $bodyText
    } | ConvertTo-Json -Depth 5
    try {
      $null = Invoke-RestMethod -Uri 'https://api.resend.com/emails' -Method Post `
        -Headers @{ Authorization = "Bearer $apiKey" } `
        -ContentType 'application/json; charset=utf-8' `
        -Body ([Text.Encoding]::UTF8.GetBytes($payload)) -TimeoutSec 20
      Write-Output ("[email] enviado via resend para " + $To.Split('@')[0] + "***@" + ($To.Split('@')[1]))
      return @{ ok = $true; reason = '' }
    } catch {
      Write-Output ("[email] provedor recusou: " + $_.Exception.Message)   # nunca loga o código
      return @{ ok = $false; reason = 'provider-error'; detail = $_.Exception.Message }
    }
  }

  # 2) SMTP local (Gmail com senha de aplicativo)
  $smtpUser = Get-Cfg 'SMTP_USER'
  $smtpPass = Get-Cfg 'SMTP_PASS'
  if ($smtpUser -and $smtpPass) {
    $smtpHost = Get-Cfg 'SMTP_HOST' 'smtp.gmail.com'
    $smtpPort = [int](Get-Cfg 'SMTP_PORT' '587')
    $fromAddr = (Get-FromParts $fromRaw).email
    $toAddr = Get-Cfg 'EMAIL_FROM'
    try {
      $cred = New-Object System.Management.Automation.PSCredential(
        $smtpUser, (ConvertTo-SecureString $smtpPass -AsPlainText -Force))
      $fromFinal = if ($fromAddr -match '@') { $fromAddr } else { $smtpUser }
      Send-MailMessage -SmtpServer $smtpHost -Port $smtpPort -UseSsl -Credential $cred `
        -From $fromFinal -To $To -Subject $subject -Body $bodyText -Encoding UTF8 `
        -ErrorAction Stop -WarningAction SilentlyContinue
      Write-Output ("[email] enviado via smtp ($smtpHost) para " + $To.Split('@')[0] + "***")
      return @{ ok = $true; reason = '' }
    } catch {
      Write-Output ("[email] smtp falhou: " + $_.Exception.Message)
      return @{ ok = $false; reason = 'provider-error'; detail = $_.Exception.Message }
    }
  }

  Write-Output '[email] nenhum provedor configurado: preencha .env (EMAIL_PROVIDER_API_KEY ou SMTP_USER/SMTP_PASS)'
  return @{ ok = $false; reason = 'not-configured'; detail = 'EMAIL_PROVIDER_API_KEY/SMTP ausentes no .env' }
}

function Send-Json($Ctx, [int]$Status, $Obj) {
  $bytes = [Text.Encoding]::UTF8.GetBytes(($Obj | ConvertTo-Json -Compress -Depth 6))
  $Ctx.Response.StatusCode = $Status
  $Ctx.Response.ContentType = 'application/json; charset=utf-8'
  $Ctx.Response.ContentLength64 = $bytes.Length
  $Ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

# ---------------- listener ----------------
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Output "Nexo server: http://localhost:$Port/  (root: $root)"
Write-Output ("API de e-mail: POST /api/send-email · provedor: " +
  $(if (Get-Cfg 'EMAIL_PROVIDER_API_KEY') { 'Resend (API key no .env)' }
    elseif ((Get-Cfg 'SMTP_USER') -and (Get-Cfg 'SMTP_PASS')) { 'SMTP local (' + (Get-Cfg 'SMTP_HOST' 'smtp.gmail.com') + ')' }
    else { 'NÃO CONFIGURADO (nada será enviado)' }))

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $local = $ctx.Request.Url.LocalPath
    if ($local -eq '/') { $local = '/index.html' }

    # ---------- API de e-mail ----------
    if ($local -eq '/api/send-email') {
      if ($ctx.Request.HttpMethod -ne 'POST') {
        Send-Json $ctx 405 @{ ok = $false; reason = 'method-not-allowed' }
        $ctx.Response.Close(); continue
      }
      try {
        $reader = New-Object IO.StreamReader($ctx.Request.InputStream, [Text.Encoding]::UTF8)
        $raw = $reader.ReadToEnd()
        $in = $raw | ConvertFrom-Json
      } catch {
        Send-Json $ctx 400 @{ ok = $false; reason = 'invalid' }
        $ctx.Response.Close(); continue
      }

      $to = [string]$in.to
      $name = [string]$in.name
      $purpose = if ([string]$in.purpose -eq 'verify') { 'verify' } else { 'recover' }
      $code = [string]$in.code

      if (-not ($to -match '^[^\s@,;:<>()[\]\\"]+@[^\s@,;:<>()[\]\\"]+\.[A-Za-z]{2,}$') -or -not ($code -match '^\d{6}$')) {
        Write-Output '[email] payload inválido (sem logar o código)'
        Send-Json $ctx 400 @{ ok = $false; reason = 'invalid' }
        $ctx.Response.Close(); continue
      }
      $to = $to.Trim().ToLower()

      if (-not (Test-RateLimit $to)) {
        Write-Output '[email] limite de envios por destinatário atingido'
        Send-Json $ctx 429 @{ ok = $false; reason = 'rate-limit' }
        $ctx.Response.Close(); continue
      }

      $result = Send-NexoMail -To $to -Name $name -Purpose $purpose -Code $code
      if ($result.ok) { Send-Json $ctx 200 @{ ok = $true } }
      elseif ($result.reason -eq 'not-configured') { Send-Json $ctx 501 @{ ok = $false; reason = 'not-configured' } }
      else { Send-Json $ctx 502 @{ ok = $false; reason = 'provider-error'; detail = [string]$result.detail } }
      $ctx.Response.Close(); continue
    }

    # ---------- arquivos proibidos ----------
    $rel = $local.TrimStart('/')
    $blocked = $rel -like '.env*' -or $rel -like '.git/*' -or $rel -eq '.git' -or $rel -like 'api/*' -or $rel -like 'node_modules/*'
    if ($blocked) {
      Send-Json $ctx 403 @{ ok = $false; reason = 'forbidden' }
      $ctx.Response.Close(); continue
    }

    # ---------- estáticos ----------
    $file = Join-Path $root ($rel -replace '/', [IO.Path]::DirectorySeparatorChar)
    if ($file.StartsWith($root) -and (Test-Path $file -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($file)
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $ctx.Response.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    }
    else {
      $msg = [Text.Encoding]::UTF8.GetBytes('404')
      $ctx.Response.StatusCode = 404
      $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
    }
    $ctx.Response.Close()
  }
  catch {
    Write-Output ("ERR " + $_.Exception.Message)
  }
}
