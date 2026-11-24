param([string]$Office, [string]$Maven = 'mvn', [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
Push-Location $PSScriptRoot
try {
    if (!(Test-Path -LiteralPath .env)) {
        $names = 'REVIEW_DB_PASSWORD','REVIEW_DB_ROOT_PASSWORD','REVIEW_OBJECT_USER','REVIEW_OBJECT_PASSWORD'
        $lines = foreach ($name in $names) {
            $secret = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
            "$name=$secret"
        }
        $file = [IO.File]::Open((Join-Path $PSScriptRoot '.env'), 'CreateNew', 'Write', 'None')
        try {
            $bytes = [Text.Encoding]::UTF8.GetBytes(($lines -join [Environment]::NewLine))
            $file.Write($bytes,0,$bytes.Length)
        } finally { $file.Dispose() }
    }
    foreach ($line in (Get-Content -LiteralPath .env)) {
        if ($line -match '^(REVIEW_(?:DB_PASSWORD|DB_ROOT_PASSWORD|OBJECT_USER|OBJECT_PASSWORD))=(.+)$') {
            [Environment]::SetEnvironmentVariable($matches[1],$matches[2],'Process')
        }
    }
    if ($Office) { $env:REVIEW_OFFICE = (Resolve-Path -LiteralPath $Office).Path }
    elseif (Test-Path m0/.tools/office/program/soffice.com) {
        $env:REVIEW_OFFICE = (Resolve-Path m0/.tools/office/program/soffice.com).Path
    }
    $env:REVIEW_OCR = (Resolve-Path m0/ocr.ps1).Path
    if (!$Office -and !$env:REVIEW_OFFICE) {
        $common = git rev-parse --path-format=absolute --git-common-dir
        $sharedOffice = Join-Path (Split-Path -Parent $common) 'm0/.tools/office/program/soffice.com'
        if (Test-Path -LiteralPath $sharedOffice) { $env:REVIEW_OFFICE = $sharedOffice }
    }
    if (!$SkipBuild) {
        if ($Maven -eq 'mvn' -and !(Get-Command mvn -ErrorAction SilentlyContinue) -and
            (Test-Path .local/apache-maven-3.9.9/bin/mvn.cmd)) {
            $Maven = (Resolve-Path .local/apache-maven-3.9.9/bin/mvn.cmd).Path
        }
        npm.cmd ci --prefix web --no-fund --no-audit
        npm.cmd run build --prefix web
        & $Maven -q -f server/pom.xml package
    }
    docker compose up -d --wait --wait-timeout 150
    Write-Host '课程页面 http://127.0.0.1:8080'
    java -jar server/target/review-import-1.0.0.jar
} finally { Pop-Location }
