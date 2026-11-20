# Pull the newest NOWA from upstream, check it against our host contract, and switch only if it passes.
#   scripts\update-nowa.ps1            # upstream main
#   scripts\update-nowa.ps1 -Ref dev   # another branch
#   scripts\update-nowa.ps1 -Status    # show lock / checkout / upstream only
param([string]$Ref = 'main', [switch]$Status, [switch]$Force)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$vpy = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $vpy)) { throw 'Not set up yet: run scripts\setup.ps1 first' }
if ($Status) { & $vpy scripts\nowa_tool.py status --ref $Ref; exit $LASTEXITCODE }
$extra = @(); if ($Force) { $extra += '--force' }
& $vpy scripts\nowa_tool.py update --ref $Ref @extra
exit $LASTEXITCODE
