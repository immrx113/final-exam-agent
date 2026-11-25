param([string]$Office, [string]$Maven = 'mvn', [switch]$SkipBuild, [string]$EnvFile)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
Push-Location $PSScriptRoot
try {
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
    if (!$Office -and !$env:REVIEW_OFFICE) {
        $common = git rev-parse --path-format=absolute --git-common-dir
        $sharedOffice = Join-Path (Split-Path -Parent $common) 'm0/.tools/office/program/soffice.com'
        if (Test-Path -LiteralPath $sharedOffice) { $env:REVIEW_OFFICE = $sharedOffice }
    }
    if (!$SkipBuild) {
        if ($Maven -eq 'mvn' -and !(Get-Command mvn -ErrorAction SilentlyContinue)) {
            foreach ($candidate in '.local/apache-maven-3.9.9/bin/mvn.cmd','.worktrees/m1/.local/apache-maven-3.9.9/bin/mvn.cmd') {
                if (Test-Path -LiteralPath $candidate) { $Maven = (Resolve-Path $candidate).Path; break }
            }
        }
        npm.cmd ci --prefix web --no-fund --no-audit
        npm.cmd run build --prefix web
        & $Maven -q -f server/pom.xml package
    }
    docker compose --env-file $EnvFile up -d --wait --wait-timeout 150
    if ((Test-Path .local/mineru-env/Scripts/mineru-api.exe) -and
        !$env:REVIEW_MINERU_URL -and
        !(Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction SilentlyContinue)) {
        $env:MINERU_MODEL_SOURCE = 'modelscope'
        $env:MODELSCOPE_CACHE = Join-Path $PSScriptRoot '.local/modelscope'
        $env:MINERU_API_MAX_CONCURRENT_REQUESTS = '1'
        Start-Process -FilePath (Resolve-Path .local/mineru-env/Scripts/mineru-api.exe).Path -WindowStyle Hidden -WorkingDirectory (Resolve-Path .local).Path -ArgumentList '--host','127.0.0.1','--port','8000' -RedirectStandardOutput .local/mineru-start.log -RedirectStandardError .local/mineru-start-error.log
    }
    Write-Host '课程页面 http://127.0.0.1:8080'
    java -jar server/target/review-import-1.0.0.jar
} finally { Pop-Location }
