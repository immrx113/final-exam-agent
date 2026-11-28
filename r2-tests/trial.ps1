param([switch]$StorageOnly, [string]$Agent = 'm2/agent.py', [int]$Port = 18127, [int]$TimeoutSeconds = 120)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$saved = @{}
foreach ($key in 'REVIEW_DB_PASSWORD','REVIEW_DB_ROOT_PASSWORD','REVIEW_OBJECT_USER','REVIEW_OBJECT_PASSWORD',
        'REVIEW_MYSQL_PORT','REVIEW_MINIO_PORT','REVIEW_REDIS_PORT','REVIEW_MQ_PORT','REVIEW_BROKER_PORT','REVIEW_SEMANTIC') {
    $saved[$key] = [Environment]::GetEnvironmentVariable($key)
}
Push-Location "$PSScriptRoot/.."
try {
    $config = '.local/r2.env'
    New-Item -ItemType Directory -Force .local | Out-Null
    if (!(Test-Path -LiteralPath $config)) {
        $values = foreach ($key in 'REVIEW_DB_PASSWORD','REVIEW_DB_ROOT_PASSWORD','REVIEW_OBJECT_USER','REVIEW_OBJECT_PASSWORD') {
            "$key=" + [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
        }
        $stream = [IO.File]::Open((Join-Path $PWD $config), 'CreateNew', 'Write', 'None')
        try { $stream.Write([Text.Encoding]::UTF8.GetBytes($values -join [Environment]::NewLine)) } finally { $stream.Dispose() }
    }
    $env:REVIEW_MYSQL_PORT = '33327'
    $env:REVIEW_MINIO_PORT = '39027'
    $env:REVIEW_REDIS_PORT = '36397'
    $env:REVIEW_MQ_PORT = '39897'
    $env:REVIEW_BROKER_PORT = '30997'
    if ($StorageOnly) {
        docker compose -p final-review-r2 --env-file $config up -d --wait
        return
    }
    $settings = ConvertFrom-StringData (Get-Content -Raw -LiteralPath $config)
    foreach ($key in 'REVIEW_DB_PASSWORD','REVIEW_OBJECT_USER','REVIEW_OBJECT_PASSWORD') {
        [Environment]::SetEnvironmentVariable($key,$settings[$key],'Process')
    }
    $env:REVIEW_SEMANTIC = '0'
    java -jar server/target/review-import-1.0.0.jar "--server.port=$Port" "--review.agent=$Agent" "--review.agent-timeout-seconds=$TimeoutSeconds" '--review.mineru-url='
} finally {
    foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key,$saved[$key],'Process') }
    Pop-Location
}
