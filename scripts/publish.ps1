#!/usr/bin/env pwsh
# Full release pipeline:
#   1. clean
#   2. publish the .NET backend
#   3. build the TypeScript package (tsup → dist/)
#   4. run lint + tests
#   5. `npm publish` from packages/node
#
# Usage:
#   ./scripts/publish.ps1                  # dry-run (no npm publish)
#   ./scripts/publish.ps1 -Confirm          # actually publish

param(
  [switch] $Confirm,
  [string] $Tag = 'latest'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$nodePkg = Join-Path $repoRoot 'packages/node'

Write-Host "==> Cleaning workspaces" -ForegroundColor Cyan
Remove-Item -Recurse -Force (Join-Path $nodePkg 'dist') -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $nodePkg 'bin') -ErrorAction SilentlyContinue

& (Join-Path $PSScriptRoot 'build-backend.ps1')

Write-Host "==> Building TypeScript package" -ForegroundColor Cyan
Push-Location $nodePkg
try {
  npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
  npm run lint
  if ($LASTEXITCODE -ne 0) { throw 'lint failed' }
  npm test
  if ($LASTEXITCODE -ne 0) { throw 'tests failed' }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'tsup build failed' }

  if ($Confirm) {
    Write-Host "==> Publishing to npm (tag=$Tag)" -ForegroundColor Cyan
    npm publish --tag $Tag --access public
    if ($LASTEXITCODE -ne 0) { throw 'npm publish failed' }
  } else {
    Write-Host "==> Dry-run only (pass -Confirm to actually publish)" -ForegroundColor Yellow
    npm pack --dry-run
  }
} finally {
  Pop-Location
}
