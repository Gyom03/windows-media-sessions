#!/usr/bin/env pwsh
# Builds the .NET 8 backend and copies the self-contained, single-file
# executable into the npm package's bin directory so it ships as a runtime
# asset. Run from the repo root.

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendProj = Join-Path $repoRoot 'packages/backend/WindowsMediaSessions.Backend.csproj'
$outDir = Join-Path $repoRoot 'packages/node/bin/win-x64'

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
  throw 'dotnet CLI not found in PATH. Install .NET 8 SDK from https://dot.net'
}

Write-Host "==> Publishing .NET backend (win-x64, self-contained, single-file)" -ForegroundColor Cyan

# /p:DebugType=none avoids dragging a separate .pdb into the npm tarball; the
# embedded one in the csproj is already enough for crash diagnostics.
dotnet publish $backendProj `
  -c Release `
  -r win-x64 `
  --self-contained true `
  /p:PublishSingleFile=true `
  /p:IncludeNativeLibrariesForSelfExtract=true `
  /p:EnableCompressionInSingleFile=true

if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed' }

$publishDir = Join-Path $repoRoot 'packages/backend/bin/Release/net8.0-windows10.0.19041.0/win-x64/publish'
$exePath = Join-Path $publishDir 'windows-media-sessions-backend.exe'

if (-not (Test-Path $exePath)) {
  throw "Expected published exe not found at $exePath"
}

if (-not (Test-Path $outDir)) {
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}

Copy-Item -Force $exePath $outDir
Write-Host "==> Backend copied to $outDir" -ForegroundColor Green
