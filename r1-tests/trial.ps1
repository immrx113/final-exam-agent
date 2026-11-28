param([string]$Office, [string]$Jar = 'server/target/review-import-1.0.0.jar')
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$previousMqPort = $env:REVIEW_MQ_PORT
$previousBrokerPort = $env:REVIEW_BROKER_PORT
Push-Location "$PSScriptRoot/.."
try {
    $binary = (Resolve-Path -LiteralPath $Jar).Path
    New-Item -ItemType Directory -Force .local | Out-Null
    $config = '.local/r1.env'
    if (!(Test-Path -LiteralPath $config)) {
        $values = foreach ($key in 'REVIEW_DB_PASSWORD','REVIEW_DB_ROOT_PASSWORD','REVIEW_OBJECT_USER','REVIEW_OBJECT_PASSWORD') {
            "$key=" + [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
        }
        $values += 'REVIEW_MYSQL_PORT=33326','REVIEW_MINIO_PORT=39026','REVIEW_REDIS_PORT=36396'
        $stream = [IO.File]::Open((Join-Path $PWD $config), 'CreateNew', 'Write', 'None')
        try { $stream.Write([Text.Encoding]::UTF8.GetBytes($values -join [Environment]::NewLine)) } finally { $stream.Dispose() }
    }
    $settings = ConvertFrom-StringData (Get-Content -Raw -LiteralPath $config)
    if ($settings.REVIEW_MYSQL_PORT -ne '33326' -or $settings.REVIEW_MINIO_PORT -ne '39026' -or $settings.REVIEW_REDIS_PORT -ne '36396') {
        throw '请核对 R1 专用端口配置。'
    }
    $env:REVIEW_MQ_PORT = '39896'
    $env:REVIEW_BROKER_PORT = '30996'
    docker compose -p final-review-r1 --env-file $config up -d --wait
    $start = [Diagnostics.ProcessStartInfo]::new((Get-Command java -ErrorAction Stop).Source)
    $start.UseShellExecute = $false
    foreach ($name in $settings.Keys) { $start.Environment[$name] = $settings[$name] }
    if (!$Office -and (Test-Path m0/.tools/office/program/soffice.com)) { $Office = 'm0/.tools/office/program/soffice.com' }
    if (!$Office -and (Test-Path "$env:ProgramFiles/LibreOffice/program/soffice.com")) { $Office = "$env:ProgramFiles/LibreOffice/program/soffice.com" }
    if ($Office) { $start.Environment['REVIEW_OFFICE'] = (Resolve-Path -LiteralPath $Office).Path }
    $start.Environment['REVIEW_SEMANTIC'] = '0'
    foreach ($arg in '-jar',$binary,'--server.port=18126','--review.mineru-url=','--logging.file.name=.local/r1-trial.log') {
        $start.ArgumentList.Add($arg)
    }
    $server = [Diagnostics.Process]::Start($start)
    try { $server.WaitForExit(); if ($server.ExitCode) { throw "Java 退出码 $($server.ExitCode)" } }
    finally { if (!$server.HasExited) { $server.Kill() }; $server.Dispose() }
} finally {
    $env:REVIEW_MQ_PORT = $previousMqPort
    $env:REVIEW_BROKER_PORT = $previousBrokerPort
    Pop-Location
}
