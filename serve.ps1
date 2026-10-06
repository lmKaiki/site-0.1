param([int]$Port = 8087)

# ============================================================
#  NEXO · servidor local (estático)
#  http://localhost:8087/
#
#  Apenas entrega os arquivos do projeto (puro estático).
#  A autenticação da Nexo é nome de usuário + senha (hash +
#  salt) e acontece inteiramente no app — este servidor não
#  tem API, não envia e-mail e não conversa com terceiros.
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

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $local = $ctx.Request.Url.LocalPath
    if ($local -eq '/') { $local = '/index.html' }

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
