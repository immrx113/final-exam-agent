# PowerShell 7, public requests only. Emit only whitelisted fields.
param([string]$Output = (Join-Path $PSScriptRoot 'out/video.json'))
$ErrorActionPreference = 'Stop'
function Read-PublicJson([string]$url) {
    $r = Invoke-WebRequest -Uri $url -TimeoutSec 20 -SkipHttpErrorCheck
    if ($r.StatusCode -ne 200) { throw "HTTP $($r.StatusCode)" }
    $j = $r.Content | ConvertFrom-Json
    if ($null -eq $j.code -or $j.code -ne 0) { throw "API code $($j.code)" }
    $j.data
}
$query = '数据库原理 关系代数'
$report = [ordered]@{query=$query; day=(Get-Date -Format yyyy-MM-dd); search=@{}; detail=@{}}
try {
    $data = Read-PublicJson ('https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=' + [uri]::EscapeDataString($query))
    $candidates = @($data.result | Where-Object bvid -match '^BV[a-zA-Z0-9]+$' |
        Select-Object -First 3 -Property bvid,@{n='title';e={[Net.WebUtility]::HtmlDecode(($_.title -replace '<[^>]+>',''))}})
    $report.search = @{ok=$true; candidates=$candidates}
    if ($candidates.Count) {
        try {
            $hit = Read-PublicJson ('https://api.bilibili.com/x/web-interface/view?bvid=' + $candidates[0].bvid)
            $report.search.first_detail = @{bvid=$hit.bvid; view=$hit.stat.view; like=$hit.stat.like; favorite=$hit.stat.favorite}
        } catch { $report.search.detail_error = $_.Exception.Message }
    }
} catch { $report.search = @{ok=$false; error=$_.Exception.Message} }
try {
    $data = Read-PublicJson 'https://api.bilibili.com/x/web-interface/view?bvid=BV13T4y1f7dn'
    $parts = @($data.pages | Where-Object part -match '关系代数' | Select-Object -First 3 -Property page,part)
    $report.detail = @{ok=$true; bvid=$data.bvid; title=$data.title; pages=@($data.pages).Count;
        matching_parts=$parts; view=$data.stat.view; like=$data.stat.like; favorite=$data.stat.favorite;
        metric_scope='whole_video'}
    if ($parts.Count) {
        $url = 'https://www.bilibili.com/video/' + $data.bvid + '/?p=' + $parts[0].page
        $report.detail.part_url = $url
        try { $report.detail.part_http = [int](Invoke-WebRequest $url -TimeoutSec 20 -SkipHttpErrorCheck).StatusCode }
        catch { $report.detail.part_error = $_.Exception.Message }
    }
} catch { $report.detail = @{ok=$false; error=$_.Exception.Message} }
New-Item -ItemType Directory -Force (Split-Path -Parent $Output) | Out-Null
$report | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 $Output
Get-Content -Raw -Encoding utf8 $Output
