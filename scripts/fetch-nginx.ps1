param(
    [string]$Version = "1.30.7",
    [string]$OutFile = "$PSScriptRoot\..\internal\nginx\embed\nginx.zip"
)

$ErrorActionPreference = "Stop"

$outDir = Split-Path -Parent $OutFile
if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

if (Test-Path $OutFile) {
    $size = (Get-Item $OutFile).Length
    if ($size -gt 500000) {
        Write-Host "[fetch-nginx] Already exists: $OutFile ($size bytes)"
        exit 0
    }
}

$url = "https://nginx.org/download/nginx-$Version.zip"
Write-Host "[fetch-nginx] Downloading $url -> $OutFile ..."
Invoke-WebRequest -Uri $url -OutFile $OutFile -UseBasicParsing

$size = (Get-Item $OutFile).Length
if ($size -lt 500000) {
    Remove-Item $OutFile -Force -ErrorAction SilentlyContinue
    throw "Downloaded file too small ($size bytes), download may have failed."
}

Write-Host "[fetch-nginx] Done ($size bytes)."
