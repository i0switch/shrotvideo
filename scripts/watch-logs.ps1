param(
    [string]$FilterPattern = ''  # e.g. 'diagnostic|\[py-backend\]|\[x:|\[tiktok:|\[youtube:|\[downloader|\[video-generator|\[scraper'
)

# Detect and tail the Electron log file (JSONL preferred), fallback to main.log.
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/watch-logs.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/watch-logs.ps1 -FilterPattern "diagnostic|\[py-backend\]|\[x:|\[tiktok:|\[youtube:|\[downloader|\[video-generator|\[scraper"

$ErrorActionPreference = 'Stop'

# Candidates in %APPDATA%
$base = $env:APPDATA
$candidates = @(
    (Join-Path $base 'vite_react_shadcn_ts\logs\app.log.jsonl'),
    (Join-Path $base 'vite_react_shadcn_ts\logs\main.log'),
    (Join-Path $base 'com.gemini.shortvideotool\logs\app.log.jsonl'),
    (Join-Path $base 'com.gemini.shortvideotool\logs\main.log')
)

$target = $null
foreach ($p in $candidates) {
    if (Test-Path $p) { $target = $p; break }
}

if (-not $target) {
    Write-Host '[watch] No log file found yet. Waiting up to 60s...'
    for ($i = 0; $i -lt 60; $i++) {
        foreach ($p in $candidates) {
            if (Test-Path $p) { $target = $p; break }
        }
        if ($target) { break }
        Start-Sleep -Seconds 1
    }
}

if (-not $target) {
    Write-Host '[watch] still no log file. Is the app running?'
    exit 2
}

Write-Host ("[watch] tailing: {0}" -f $target)
if ([string]::IsNullOrWhiteSpace($FilterPattern)) {
    # Tail and stream; Ctrl+C to stop.
    Get-Content -Path $target -Tail 200 -Wait
} else {
    Write-Host ("[watch] filter: {0}" -f $FilterPattern)
    Get-Content -Path $target -Tail 200 -Wait | Select-String -Pattern $FilterPattern
}
