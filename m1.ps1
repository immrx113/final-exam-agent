param([string]$Office, [string]$Maven = 'mvn', [switch]$SkipBuild, [string]$EnvFile, [switch]$Trial, [switch]$BasicParsing)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
Push-Location $PSScriptRoot
$savedEnv = @{}
foreach ($name in 'REVIEW_DB_PASSWORD','REVIEW_DB_ROOT_PASSWORD','REVIEW_OBJECT_USER','REVIEW_OBJECT_PASSWORD','REVIEW_MYSQL_PORT','REVIEW_MINIO_PORT','REVIEW_REDIS_PORT','REVIEW_PYTHON','REVIEW_SEMANTIC','REVIEW_OFFICE','REVIEW_AGENT','REVIEW_OCR','MINERU_MODEL_SOURCE','MODELSCOPE_CACHE','MINERU_API_MAX_CONCURRENT_REQUESTS') {
    $savedEnv[$name] = [Environment]::GetEnvironmentVariable($name)
}
try {
    $composeArgs = @()
    $serverArgs = @()
    $port = 8080
    if ($Trial) {
        New-Item -ItemType Directory -Force .local | Out-Null
        if (!$EnvFile) { $EnvFile = '.local/m5.env' }
        $composeArgs = @('-p', 'final-review-m5')
        $port = 18085
        $env:REVIEW_MYSQL_PORT = '33315'
        $env:REVIEW_MINIO_PORT = '39015'
        $env:REVIEW_REDIS_PORT = '36385'
        $serverArgs = @("--server.port=$port")
    }
    if ($BasicParsing) { $serverArgs += '--review.mineru-url=' }
    if (!$EnvFile) {
        $EnvFile = '.env'
        if (!(Test-Path -LiteralPath $EnvFile) -and (Test-Path -LiteralPath '.worktrees/m1/.env')) {
            $EnvFile = '.worktrees/m1/.env'
        }
    }
    if (!(Test-Path -LiteralPath $EnvFile)) {
        $names = 'REVIEW_DB_PASSWORD','REVIEW_DB_ROOT_PASSWORD','REVIEW_OBJECT_USER','REVIEW_OBJECT_PASSWORD'
        $lines = foreach ($name in $names) {
            $secret = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
            "$name=$secret"
        }
        $file = [IO.File]::Open($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($EnvFile), 'CreateNew', 'Write', 'None')
        try {
            $bytes = [Text.Encoding]::UTF8.GetBytes(($lines -join [Environment]::NewLine))
            $file.Write($bytes,0,$bytes.Length)
        } finally { $file.Dispose() }
    }
    foreach ($line in (Get-Content -LiteralPath $EnvFile)) {
        if ($line -match '^(REVIEW_(?:DB_PASSWORD|DB_ROOT_PASSWORD|OBJECT_USER|OBJECT_PASSWORD))=(.+)$') {
            [Environment]::SetEnvironmentVariable($matches[1],$matches[2],'Process')
        }
    }
    if ($Office) { $env:REVIEW_OFFICE = (Resolve-Path -LiteralPath $Office).Path }
    elseif (Test-Path m0/.tools/office/program/soffice.com) {
        $env:REVIEW_OFFICE = (Resolve-Path m0/.tools/office/program/soffice.com).Path
    }
    $env:REVIEW_OCR = (Resolve-Path m0/ocr.ps1).Path
    $env:REVIEW_AGENT = (Resolve-Path m2/agent.py).Path
    if (!$env:REVIEW_PYTHON -and (Test-Path m0/.tools/model.onnx) -and (Get-Command py -ErrorAction SilentlyContinue)) {
        try { $env:REVIEW_PYTHON = py -3.12 -c "import sys;print(sys.executable)" 2>$null }
        catch { $env:REVIEW_PYTHON = $null }
    }
    if (!$env:REVIEW_PYTHON) { $env:REVIEW_PYTHON = (Get-Command python -ErrorAction Stop).Source }
    if (!$env:REVIEW_SEMANTIC -and (Test-Path m0/.tools/model.onnx) -and (Test-Path m0/.tools/tokenizer.json)) {
        try {
            & $env:REVIEW_PYTHON -c "import sys; sys.path.insert(0,'m0/.tools/site'); import numpy, onnxruntime, tokenizers" 2>$null
            if ($LASTEXITCODE -eq 0) { $env:REVIEW_SEMANTIC = '1' }
        } catch { Write-Host '未载入 M0 语义模型，按定义、别名和题干分析。' }
    }
    if (!$Office -and !$env:REVIEW_OFFICE -and (Get-Command soffice.com -ErrorAction SilentlyContinue)) {
        $env:REVIEW_OFFICE = (Get-Command soffice.com).Source
    }
    if (!$Office -and !$env:REVIEW_OFFICE -and (Test-Path "$env:ProgramFiles/LibreOffice/program/soffice.com")) {
        $env:REVIEW_OFFICE = "$env:ProgramFiles/LibreOffice/program/soffice.com"
    }
    if (!$Trial -and !$Office -and !$env:REVIEW_OFFICE -and (Test-Path .git) -and (Get-Command git -ErrorAction SilentlyContinue)) {
        $common = git rev-parse --path-format=absolute --git-common-dir
        $sharedOffice = Join-Path (Split-Path -Parent $common) 'm0/.tools/office/program/soffice.com'
        if (Test-Path -LiteralPath $sharedOffice) { $env:REVIEW_OFFICE = $sharedOffice }
    }
    if (!$SkipBuild) {
        if ($Maven -eq 'mvn' -and !(Get-Command mvn -ErrorAction SilentlyContinue)) {
            $candidates = @('.local/apache-maven-3.9.9/bin/mvn.cmd')
            if (!$Trial) { $candidates += '.worktrees/m1/.local/apache-maven-3.9.9/bin/mvn.cmd' }
            foreach ($candidate in $candidates) {
                if (Test-Path -LiteralPath $candidate) { $Maven = (Resolve-Path $candidate).Path; break }
            }
        }
        npm.cmd ci --prefix web --no-fund --no-audit
        npm.cmd run build --prefix web
        & $Maven -q -f server/pom.xml package
    }
    docker compose @composeArgs --env-file $EnvFile up -d --wait --wait-timeout 150
    if (!$BasicParsing -and (Test-Path .local/mineru-env/Scripts/mineru-api.exe) -and
        !$env:REVIEW_MINERU_URL -and
        !(Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction SilentlyContinue)) {
        $env:MINERU_MODEL_SOURCE = 'modelscope'
        $env:MODELSCOPE_CACHE = Join-Path $PSScriptRoot '.local/modelscope'
        $env:MINERU_API_MAX_CONCURRENT_REQUESTS = '1'
        Start-Process -FilePath (Resolve-Path .local/mineru-env/Scripts/mineru-api.exe).Path -WindowStyle Hidden -WorkingDirectory (Resolve-Path .local).Path -ArgumentList '--host','127.0.0.1','--port','8000' -RedirectStandardOutput .local/mineru-start.log -RedirectStandardError .local/mineru-start-error.log
    }
    Write-Host "课程页面 http://127.0.0.1:$port"
    java -jar server/target/review-import-1.0.0.jar @serverArgs
} finally {
    foreach ($name in $savedEnv.Keys) {
        [Environment]::SetEnvironmentVariable($name, $savedEnv[$name], 'Process')
    }
    Pop-Location
}
