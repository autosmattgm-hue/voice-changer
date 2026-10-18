$ErrorActionPreference = 'Continue'
$base = 'http://localhost:3111'
$out = 'E:\jjjjjj\logs\_auth-e2e.txt'
$L = @()
function Add-Line([string]$t){ $script:L += $t }

function Post($path,$json){
  try {
    $r = Invoke-WebRequest -Uri "$base$path" -Method POST -Body $json -ContentType 'application/json' -UseBasicParsing -TimeoutSec 45
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

# 1. security headers (CSP must allow gstatic; COOP must allow popups)
try {
  $r = Invoke-WebRequest -Uri "$base/" -UseBasicParsing -TimeoutSec 15
  $csp = [string]$r.Headers['Content-Security-Policy']
  $coop = [string]$r.Headers['Cross-Origin-Opener-Policy']
  Add-Line "ROOT STATUS=$($r.StatusCode)"
  Add-Line "CSP_HAS_GSTATIC=$($csp -match 'gstatic') CSP_HAS_IDTK=$($csp -match 'identitytoolkit') CSP_HAS_APIS=$($csp -match 'apis.google.com')"
  Add-Line "COOP=$coop"
} catch { Add-Line "ROOT ERROR=$($_.Exception.Message)" }

# 2. phone UI fully removed
try {
  $r = Invoke-WebRequest -Uri "$base/login.html" -UseBasicParsing -TimeoutSec 15
  Add-Line "LOGIN_PAGE STATUS=$($r.StatusCode) HAS_PHONE_TOGGLE=$($r.Content -match 'data-phone-toggle') HAS_PHONE_INPUT=$($r.Content -match 'id=\"phone\"') HAS_GOOGLE=$($r.Content -match 'data-google-auth')"
} catch { Add-Line "LOGIN_PAGE ERROR=$($_.Exception.Message)" }
try {
  $r = Invoke-WebRequest -Uri "$base/signup.html" -UseBasicParsing -TimeoutSec 15
  Add-Line "SIGNUP_PAGE STATUS=$($r.StatusCode) HAS_PHONE_TOGGLE=$($r.Content -match 'data-phone-toggle') HAS_SMSCODE=$($r.Content -match 'smsCode') HAS_RECAPTCHA=$($r.Content -match 'recaptcha-container') HAS_GOOGLE=$($r.Content -match 'data-google-auth')"
} catch { Add-Line "SIGNUP_PAGE ERROR=$($_.Exception.Message)" }

# 3. auth flows
Add-Line ("OWNER_LOGIN " + (Post '/api/auth/login' '{"email":"owner@matleads.local","password":"admin2026"}'))

$em = "e2e-$(Get-Random)@example.com"
Add-Line ("REGISTER email=$em " + (Post '/api/auth/register' ('{"name":"E2E Tester","email":"'+$em+'","password":"Password123"}')))
Add-Line ("USER_LOGIN " + (Post '/api/auth/login' ('{"email":"'+$em+'","password":"Password123"}')))
Add-Line ("USER_LOGIN_BADPW " + (Post '/api/auth/login' ('{"email":"'+$em+'","password":"WrongPass999"}')))
Add-Line ("PHONE_LOGIN_BODY " + (Post '/api/auth/login' '{"phone":"+2348012345678","password":"Password123"}'))
Add-Line ("NO_EMAIL " + (Post '/api/auth/login' '{"password":"Password123"}'))
Add-Line ("FIREBASE_GARBAGE_TOKEN " + (Post '/api/auth/firebase' '{"idToken":"garbage.token.value"}'))

$L | Out-File -FilePath $out -Encoding utf8
Add-Line "DONE"