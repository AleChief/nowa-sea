# Prepare NOWA Sea on Windows: venv, Python deps, NOWA at the locked commit, renderer build.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$py = (Get-Command python -ErrorAction SilentlyContinue)
if (-not $py) { $py = (Get-Command py -ErrorAction Stop) }
$ver = & $py.Source -c "import sys; print('%d.%d' % sys.version_info[:2])"
if ([version]$ver -lt [version]'3.10') { throw "Python 3.10+ required, found $ver" }

if (-not (Test-Path .venv)) {
    Write-Host "Creating .venv (Python $ver)"
    & $py.Source -m venv .venv
}
$vpy = Join-Path $root '.venv\Scripts\python.exe'
& $vpy -m pip install --upgrade pip --quiet
& $vpy -m pip install -r requirements-dev.txt --quiet
if ($LASTEXITCODE -ne 0) { throw 'pip install failed' }

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
Write-Host "`nSetup complete. Start with: scripts\run.ps1"
