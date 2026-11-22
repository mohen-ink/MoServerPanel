param(
    [string]$Output = "$PSScriptRoot\..\mo-server-panel.exe",
    [string]$Version = "0.1.3",
    [switch]$SkipFrontend,
    [switch]$SkipNginxFetch
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."

Push-Location $root
try {
    if (-not $SkipNginxFetch) {
        Write-Host "=== [1/3] Ensuring embedded Nginx zip ==="
        & "$PSScriptRoot\fetch-nginx.ps1"
    }

    if (-not $SkipFrontend) {
        Write-Host "=== [2/3] Building frontend (web/) ==="
        Push-Location "$root\web"
        try {
            if (-not (Test-Path "node_modules")) {
                npm ci
                if ($LASTEXITCODE -ne 0) { npm install }
            }
            npm run build
            if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }
        } finally {
            Pop-Location
        }
    }

    Write-Host "=== [3/3] Building single-binary Go executable ==="
    $env:CGO_ENABLED = "0"
    $env:GOOS = "windows"
    $env:GOARCH = "amd64"
    $ldflags = "-s -w -X main.Version=$Version"
    go build -trimpath -ldflags $ldflags -o $Output ./cmd/panel
    if ($LASTEXITCODE -ne 0) { throw "Go build failed" }

    $item = Get-Item $Output
    Write-Host "=== Build succeeded: $($item.FullName) ($([math]::Round($item.Length / 1MB, 2)) MB) ==="
} finally {
    Pop-Location
}
