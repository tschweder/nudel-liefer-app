# Deploys the Nudel Liefer App to the vServer (NUD-127). Reads REMOTE_IP / REMOTE_USER from .env.
# Double-click deploy.bat, or: powershell -File deploy\deploy.ps1 [-AllowDirty]
#
# Native tools (ssh, scp, tar) report through $LASTEXITCODE; 'Stop' would turn their stderr into
# fatal errors in Windows PowerShell 5.1. Do not "improve" this.
param([switch]$AllowDirty)
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

if (-not (Test-Path '.env')) { throw '.env is missing (REMOTE_IP / REMOTE_USER).' }
$envVars = @{}
Get-Content .env | Where-Object { $_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$' } | ForEach-Object { $envVars[$Matches[1]] = $Matches[2].Trim().Trim('"') }
$ip = $envVars.REMOTE_IP; $user = $envVars.REMOTE_USER
if (-not $ip -or -not $user) { throw '.env must set REMOTE_IP and REMOTE_USER.' }
$target = "$user@$ip"
$key = Join-Path $HOME '.ssh\id_ed25519'

# --- pre-flight: never deploy a dirty tree by accident -----------------------------------------
$head = (git rev-parse --short HEAD).Trim()
# Tracked changes only: untracked scratch (QA reports, logs, .pnpm-store, ...) is normal and is
# excluded from the tarball below anyway, so it must not block a deploy.
$dirty = @(git status --porcelain --untracked-files=no)
$untracked = @(git status --porcelain --untracked-files=all | Where-Object { $_ -match '^\?\?' })
if ($dirty.Count -gt 0 -and -not $AllowDirty) {
  Write-Host "The working tree has $($dirty.Count) uncommitted change(s) to tracked files:" -ForegroundColor Yellow
  $dirty | Select-Object -First 15 | ForEach-Object { Write-Host "  $_" }
  throw "Refusing to deploy a dirty tree at $head. Commit first, or re-run with -AllowDirty."
}
Write-Host "Deploying $head (tracked changes: $($dirty.Count), untracked scratch: $($untracked.Count), none of them shipped: only tracked files go into the tarball)" -ForegroundColor Cyan

# --- ssh key -----------------------------------------------------------------------------------
if (-not (Test-Path $key)) {
  Write-Host 'Creating an SSH key so you only type the server password once...'
  New-Item -ItemType Directory -Force (Split-Path $key) | Out-Null
  ssh-keygen -t ed25519 -N '""' -f $key -q
}
cmd /c "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i `"$key`" $target true >nul 2>&1"
if ($LASTEXITCODE -ne 0) {
  Write-Host "`nInstalling your SSH key on $ip. Enter the server password (REMOTE_PASSWORD in .env) when asked:" -ForegroundColor Yellow
  Get-Content "$key.pub" | ssh -o StrictHostKeyChecking=accept-new $target 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
  if ($LASTEXITCODE -ne 0) { throw 'Could not log in to the server.' }
}

# --- pack and ship -----------------------------------------------------------------------------
# node_modules and .next are built on the server (Prisma engines are platform specific).
# Excluding a TOP-LEVEL directory prunes it reliably; patterns for nested directories did not
# (a nested copy of the app under docs/qa-.../ once produced "Filename too long" warnings), so the
# whole docs/ tree is excluded - the server build reads none of it. Only tracked files ship (see
# below), so scratch, logs and untracked directories can never end up in a build.
$tgz = Join-Path $env:TEMP 'nudel-delivery-app.tgz'
if (Test-Path $tgz) { Remove-Item $tgz -Force }
# NUD-133: ship TRACKED files only (git ls-files), so an untracked scratch file can never become
# part of a build and a clean checkout is exactly what gets deployed. Tracked files that are
# deleted in the working tree (possible with -AllowDirty) are skipped.
$skip = '^(deploy/|docs/|\.git/|test-results/|playwright-report/|web-test/|\.lighthouseci/|\.redesign/|\.pnpm-store/)'
$list = Join-Path $env:TEMP 'nudel-delivery-app.files'
git ls-files | Where-Object { $_ -notmatch $skip -and $_ -ne '.env' -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
  Set-Content -Path $list -Encoding ASCII
if ($LASTEXITCODE -ne 0) { throw 'git ls-files failed.' }
tar -czf $tgz -C $root -T $list
if ($LASTEXITCODE -ne 0) { throw 'tar failed.' }
Remove-Item $list -Force -ErrorAction SilentlyContinue

scp -i $key $tgz $PSScriptRoot/server-setup.sh "${target}:/tmp/"
if ($LASTEXITCODE -ne 0) { throw 'Upload failed.' }

ssh -i $key $target "sed -i 's/\r$//' /tmp/server-setup.sh && bash /tmp/server-setup.sh $ip /tmp/nudel-delivery-app.tgz"
if ($LASTEXITCODE -ne 0) { throw 'Server setup failed (see the output above).' }

Write-Host "`nDone:" -ForegroundColor Green
Write-Host "  Büro:   https://$ip/delivery-app/de/login"
Write-Host "  Fahrer: https://$ip/delivery-app/de/driver/login"
Write-Host "  Hilfe:  https://$ip/delivery-app/hand-off.html"

# Explicit success status (NUD-133). Every failure above throws. Without this, the exit code of a
# healthy run could come from a stale native $LASTEXITCODE / stderr noise of ssh and scp.
exit 0
