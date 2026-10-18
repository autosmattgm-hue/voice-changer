$ErrorActionPreference = 'Continue'
$base = 'http://localhost:3111'
$out = 'E:\jjjjjj\logs\_ai-test.txt'
$L = @()
function Add-Line([string]$t){ $script:L += $t }

function Req($method,$path,$json,$tok,$timeout=120){
  $h = @{}
  if ($tok) { $h['Authorization'] = "Bearer $tok" }
  try {
    $r = Invoke-WebRequest -Uri "$base$path" -Method $method -Headers $h -Body $json -ContentType 'application/json' -UseBasicParsing -TimeoutSec $timeout
    return "STATUS=$($r.StatusCode) BODY=$($r.Content)"
  } catch {
    $resp = $_.Exception.Response
    if ($resp) {
      $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
      return "STATUS=$([int]$resp.StatusCode) BODY=$($sr.ReadToEnd())"
    }
    return "ERROR=$($_.Exception.Message)"
  }
}

# login
$login = Req 'POST' '/api/auth/login' '{"email":"owner@matleads.local","password":"admin2026"}'
Add-Line "LOGIN_OK=$($login -match 'STATUS=200')"
$tok = $null
try { $body = ($login -replace '^STATUS=\d+ BODY=','') | ConvertFrom-Json; $tok = $body.accessToken } catch { Add-Line "TOK_ERR=$($_.Exception.Message)" }
if (-not $tok) { Add-Line 'NO_TOKEN'; $L | Out-File $out -Encoding utf8; exit 1 }
Add-Line "TOK_LEN=$($tok.Length)"

# status
Add-Line ("STATUS " + (Req 'GET' '/api/ai/status' $null $tok))

# chat
Add-Line ("CHAT " + (Req 'POST' '/api/ai/chat' '{"prompt":"Reply with exactly: AI console works."}' $tok 90))

# tycoon
Add-Line ("TYCOON " + (Req 'POST' '/api/ai/tycoon' '{"prompt":"Write a 3-line WhatsApp opener for a roof repair business.","lead":{}}' $tok 90))

# website build (1 page, minimal)
$wb = '{"businessName":"Test Bakery","style":"modern","pages":1,"lead":{"name":"Test Bakery","businessType":"bakery"}}'
Add-Line ("WEBSITE " + (Req 'POST' '/api/ai/websites' $wb $tok 150))

# debug endpoint (admin)
Add-Line ("DEBUG " + (Req 'POST' '/api/ai/debug' '{"prompt":"Say OK in 3 words."}' $tok 90))

$L | Out-File -FilePath $out -Encoding utf8
Add-Line 'DONE'
