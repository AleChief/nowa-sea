# Prepare NOWA Sea on Windows: venv, Python deps, NOWA at the locked commit, renderer build.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# The first interpreter that actually runs: on a fresh Windows "python" is often the Microsoft Store stub.
$py = $null; $ver = $null
foreach ($cand in @(@('py', '-3'), @('python'), @('python3'))) {
    if (-not (Get-Command $cand[0] -ErrorAction SilentlyContinue)) { continue }
    $extra = @($cand | Select-Object -Skip 1)
    # try/catch: with 'Stop', anything a stub writes to stderr would abort the script
    try { $v = & $cand[0] @extra -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null } catch { continue }
    if ($LASTEXITCODE -eq 0 -and $v) { $py = $cand; $ver = "$v".Trim(); break }
}
# Only what cannot run is an error; a version other than the tested one is a warning.
if (-not $py) { throw 'Python 3.10+ not found: install it from https://www.python.org/downloads/' }
if ([version]$ver -lt [version]'3.10') { throw "Python 3.10+ required, found $ver" }
if ([version]$ver -ne [version]'3.14') { Write-Warning "NOWA Sea is tested on Python 3.14; found $ver" }

if (-not (Test-Path .venv)) {
    Write-Host "Creating .venv (Python $ver)"
    $extra = @($py | Select-Object -Skip 1)
    & $py[0] @extra -m venv .venv
}
$vpy = Join-Path $root '.venv\Scripts\python.exe'
& $vpy -m pip install --upgrade pip --quiet
# Tested package versions first (constraints.txt, needs Python 3.12+); if they cannot be installed here, the newest
# compatible ones with a warning.
$pinned = $false
if ([version]$ver -ge [version]'3.12') {
    & $vpy -m pip install -r requirements-dev.txt -c constraints.txt --quiet
    $pinned = ($LASTEXITCODE -eq 0)
}
if (-not $pinned) {
    Write-Warning 'The tested package versions (constraints.txt) cannot be installed with this Python; installing the newest compatible ones instead.'
    & $vpy -m pip install -r requirements-dev.txt --quiet
    if ($LASTEXITCODE -ne 0) { throw 'pip install failed' }
}

& $vpy scripts\nowa_tool.py fetch
if ($LASTEXITCODE -ne 0) { throw 'NOWA fetch failed' }
& $vpy scripts\nowa_tool.py check
if ($LASTEXITCODE -ne 0) { throw 'NOWA compatibility check failed' }

if (Test-Path renderer\package.json) {
    Push-Location renderer
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'Node.js 18+ (npm) is required to build the renderer' }
    if (Test-Path package-lock.json) { npm ci --no-audit --no-fund } else { npm install --no-audit --no-fund }
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'npm install failed' }
    npm run build
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'renderer build failed' }
    Pop-Location
}
Write-Host "`nSetup complete. Start with: NOWA-Sea.bat (double-click) or scripts\run.ps1"
