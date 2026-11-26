param([string]$Office = 'soffice.com')
$ErrorActionPreference = 'Stop'
$out = (New-Item -ItemType Directory -Force "$PSScriptRoot/../.local/m5-samples").FullName
$profile = [Uri]::new((Join-Path $out 'office-profile')).AbsoluteUri
function Convert-Sample($source, $format) {
    & $Office "-env:UserInstallation=$profile" --headless --convert-to $format --outdir $out $source
    if ($LASTEXITCODE -ne 0 -or !(Test-Path ([IO.Path]::ChangeExtension((Join-Path $out (Split-Path $source -Leaf)), $format)))) {
        throw "样本转换失败 $source"
    }
}
Convert-Sample "$PSScriptRoot/../m0/fixtures/lesson.fodp" 'pptx'
function Write-Pdf($name, $paragraphs) {
    $source = Join-Path $out "$name.fodt"
    $template = [IO.File]::ReadAllText("$PSScriptRoot/../m0/fixtures/notes.fodt")
    $body = ($paragraphs | ForEach-Object { '<text:p>' + [Security.SecurityElement]::Escape($_) + '</text:p>' }) -join ''
    [IO.File]::WriteAllText($source, ($template -replace '<office:text>.*?</office:text>', "<office:text>$body</office:text>"))
    Convert-Sample $source 'pdf'
}
Write-Pdf '讲义' @('关系数据理论','函数依赖：用属性间的决定关系约束关系模式。','关系代数：使用选择、投影和连接运算表达查询。','死锁：事务之间相互等待对方持有的资源。','练习：写出下面的函数依赖。')
Write-Pdf '乙卷' @('数据库原理乙卷','第1题 用关系代数写出学生选课查询。')
[IO.File]::WriteAllLines("$out/甲卷.md", @('数据库原理甲卷','第1题 解释函数依赖的含义。','第2题 写出一个函数依赖。','第3题 判断给定函数依赖是否成立。','第4题 举例说明函数依赖。','第5题 用关系代数表示查询。'))
# One complete scanned paper and one detached page of unknown membership.
Add-Type -AssemblyName System.Drawing
$bitmap = [Drawing.Bitmap]::new(960, 140)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$font = [Drawing.Font]::new('Microsoft YaHei', 28)
try {
    $graphics.Clear([Drawing.Color]::White)
    $graphics.DrawString('第6题 请判断函数依赖。', $font, [Drawing.Brushes]::Black, 20, 30)
    $bitmap.Save("$out/散页.png", [Drawing.Imaging.ImageFormat]::Png)
    $graphics.Clear([Drawing.Color]::White)
    $graphics.DrawString('数据库原理试卷 共1页', $font, [Drawing.Brushes]::Black, 20, 8)
    $graphics.DrawString('第1题 请用关系代数表示投影运算。', $font, [Drawing.Brushes]::Black, 20, 75)
    $bitmap.Save("$out/丙卷.png", [Drawing.Imaging.ImageFormat]::Png)
} finally { $font.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
Convert-Sample "$out/丙卷.png" 'pdf'
Write-Host $out
