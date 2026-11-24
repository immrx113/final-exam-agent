# PowerShell 7 on 64-bit Windows. No system-wide package installation.
param([string]$Python = 'python', [switch]$SkipOffice)
$ErrorActionPreference = 'Stop'
$tools = (New-Item -Force -ItemType Directory (Join-Path $PSScriptRoot '.tools')).FullName

function Get-Dependency([string]$File, [string]$Uri, [string]$Hash) {
    $path = Join-Path $tools $File
    if ((Test-Path $path) -and (Get-FileHash $path).Hash -eq $Hash) { return }
    $temp = "$path.download"
    curl.exe -fLsS --retry 2 --max-time 600 $Uri -o $temp
    if ($LASTEXITCODE -ne 0 -or (Get-FileHash $temp).Hash -ne $Hash) {
        throw "Download or SHA-256 verification failed for $File"
    }
    Move-Item -LiteralPath $temp -Destination $path -Force
}

$maven = 'https://repo.maven.apache.org/maven2'
$model = 'https://modelscope.cn/models/Xenova/bge-small-zh-v1.5/resolve/master'
Get-Dependency 'gson.jar' "$maven/com/google/code/gson/gson/2.11.0/gson-2.11.0.jar" '57928D6E5A6EDEB2ABD3770A8F95BA44DCE45F3B23B7A9DC2B309C581552A78B'
Get-Dependency 'pdfbox.jar' "$maven/org/apache/pdfbox/pdfbox-app/3.0.5/pdfbox-app-3.0.5.jar" 'D076467FD02214EBC7B5B9D5B3B9AC0891EF768168114ED8A4811B5D16606285'
Get-Dependency 'model.onnx' "$model/onnx/model_quantized.onnx" '15B717C382BCB518BA457B93EA6850EDE7F4F1CD8937454AA06972366CD19BCC'
Get-Dependency 'tokenizer.json' "$model/tokenizer.json" '48CEA5D44424912A6FD1EA647BF4FE50B55AB8B1E5879C3275F80E339E8FAE26'
& $Python -m pip install --disable-pip-version-check --upgrade --only-binary=:all: --target (Join-Path $tools 'site') 'onnxruntime==1.32.0' 'tokenizers==0.23.3' 'numpy==2.5.5'
if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed' }

if (!$SkipOffice -and !(Test-Path (Join-Path $tools 'office/program/soffice.com'))) {
    Get-Dependency 'office.msi' 'https://mirrors.tuna.tsinghua.edu.cn/libreoffice/libreoffice/stable/26.8.3/win/x86_64/LibreOffice_26.8.3_Win_x86-64.msi' '0E6918C273EABBDBBD800EE0DACBBF130A14C13C2E4CEC861B06DD59E015BF94'
    $package = Join-Path $tools 'office.msi'
    $destination = Join-Path $tools 'office'
    $installer = Start-Process msiexec.exe -ArgumentList @('/a', ('"' + $package + '"'), '/qn', ('TARGETDIR="' + $destination + '"')) -WindowStyle Hidden -Wait -PassThru
    if ($installer.ExitCode -ne 0) { throw "LibreOffice extraction exited $($installer.ExitCode)" }
}
