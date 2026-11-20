# Start the NOWA Sea server and open the aquarium in the browser. Extra args go to the server
# (python -m nowasea.server --help), e.g.:  scripts\run.ps1 -- --agents-scale 0.25 --brain-workers 2
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$vpy = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $vpy)) { throw 'Not set up yet: run scripts\setup.ps1 first' }
$serverArgs = @($args | Where-Object { $_ -ne '--' })
& $vpy -m nowasea.server --open @serverArgs
exit $LASTEXITCODE
