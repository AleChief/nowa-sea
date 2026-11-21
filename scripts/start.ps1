# One-click start for Windows (called by NOWA-Sea.bat): check the required programs, install on the first start,
# then run the server and open the aquarium. Arguments go to the server, e.g.: NOWA-Sea.bat --new --scale 0.25
# Saved as UTF-8 with BOM so that Windows PowerShell 5.1 reads the Russian messages correctly.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Test-Runs([string[]]$cmd) {
    # True if the program exists and actually runs. A Microsoft Store "python" stub fails here.
    if (-not (Get-Command $cmd[0] -ErrorAction SilentlyContinue)) { return $false }
    $extra = @($cmd | Select-Object -Skip 1)
    try { & $cmd[0] @extra --version *> $null } catch { return $false }
    return ($LASTEXITCODE -eq 0)
}

$ready = (Test-Path '.venv\Scripts\python.exe') -and (Test-Path 'vendor\nowa\src') -and (Test-Path 'renderer\dist\index.html')
if (-not $ready) {
    Write-Host ''
    Write-Host ' First start: installing NOWA Sea. This takes a few minutes.'
    Write-Host ' Первый запуск: установка NOWA Sea, это займёт несколько минут.'
    Write-Host ''
    $missing = @()
    if (-not ((Test-Runs @('py', '-3')) -or (Test-Runs @('python')))) {
        $missing += , @('Python 3.10+', 'https://www.python.org/downloads/', 'Python.Python.3.12')
    }
    if (-not (Test-Runs @('git'))) { $missing += , @('Git', 'https://git-scm.com/download/win', 'Git.Git') }
    if (-not (Test-Runs @('npm.cmd'))) { $missing += , @('Node.js 18+', 'https://nodejs.org/', 'OpenJS.NodeJS.LTS') }
    if ($missing.Count) {
        foreach ($m in $missing) {
            Write-Host " Missing / не найдено: $($m[0])" -ForegroundColor Yellow
            Write-Host "   download / скачать: $($m[1])"
            Write-Host "   or / или: winget install $($m[2])"
        }
        Write-Host ''
        Write-Host ' Install the programs above, then start NOWA-Sea.bat again.'
        Write-Host ' Установите программы выше и снова запустите NOWA-Sea.bat.'
        exit 1
    }
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'setup.ps1')
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host ''
Write-Host ' The aquarium opens in your browser. Keep this window open while you watch.'
Write-Host ' To stop and save the world, press Ctrl+C here.'
Write-Host ' Аквариум откроется в браузере. Не закрывайте это окно, пока смотрите.'
Write-Host ' Чтобы остановить и сохранить мир, нажмите здесь Ctrl+C.'
Write-Host ''
& (Join-Path $PSScriptRoot 'run.ps1') @args
exit $LASTEXITCODE
