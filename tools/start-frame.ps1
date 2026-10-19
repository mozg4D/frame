$ErrorActionPreference = 'Stop'
$frameUrl = 'http://127.0.0.1:56116/index.html'
$running = $false
try { $running = (Invoke-WebRequest -Uri $frameUrl -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch {}
if (-not $running) {
    $python = (Get-Command python -ErrorAction Stop).Source
    Start-Process -FilePath $python -ArgumentList @('-u', "`"$PSScriptRoot\serve.py`"", '--port', '56116') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        try { if ((Invoke-WebRequest -Uri $frameUrl -UseBasicParsing -TimeoutSec 1).StatusCode -eq 200) { $running = $true; break } } catch {}
        Start-Sleep -Milliseconds 100
    }
}
if (-not $running) { throw 'Frame server did not start.' }
Start-Process $frameUrl
