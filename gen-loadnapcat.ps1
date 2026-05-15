param([string]$NapcatDir)
$fwd = $NapcatDir.Replace('\', '/').TrimEnd('/') + '/'
$content = "(async () => {await import(""file:///$fwd" + "napcat.mjs"")})()"
Set-Content -Path (Join-Path $NapcatDir 'loadNapCat.js') -Value $content -Encoding ASCII
Write-Output "loadNapCat.js updated: $content"
