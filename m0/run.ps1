param([string]$Python = 'python', [string]$Office)
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    $out = (New-Item -ItemType Directory -Path ('out/run-' + [guid]::NewGuid().ToString('N'))).FullName
    $Python = (Get-Command $Python -ErrorAction Stop).Source
    if (!$Office) { $Office = Join-Path $PSScriptRoot '.tools/office/program/soffice.com' }
    Copy-Item fixtures/outline.md $out
    if (Test-Path $Office) {
        $profile = [Uri]::new((Join-Path $out 'office-profile')).AbsoluteUri
        foreach ($format in 'ppt','pptx','doc','docx') {
            $slides = $format.StartsWith('ppt')
            $name = if ($slides) { 'lesson' } else { 'notes' }
            $source = if ($slides) { 'fixtures/lesson.fodp' } else { 'fixtures/notes.fodt' }
            & $Office "-env:UserInstallation=$profile" --headless --convert-to $format --outdir $out $source
            $file = Join-Path $out "$name.$format"
            if (!(Test-Path $file)) { Write-Warning "Missing generated $format"; continue }
            & $Office "-env:UserInstallation=$profile" --headless --convert-to pdf --outdir $out $file
            $preview = Join-Path $out "$name.pdf"
            if (Test-Path $preview) { Move-Item -LiteralPath $preview -Destination "$file.pdf" }
        }
    } else { Write-Warning 'Office unavailable, its four sample checks will fail.' }
    java '-Dfile.encoding=UTF-8' -cp '.tools/gson.jar;.tools/pdfbox.jar' Probe.java $out $Python
    if ($LASTEXITCODE -ne 0) { throw "Probe exited $LASTEXITCODE. Inspect $out" }
} finally { Pop-Location }
