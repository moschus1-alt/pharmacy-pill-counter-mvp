$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw '이 파일은 관리자 권한으로 실행해 주세요.' }
# Explicit user-run setup only. Never open the public profile or internet range.
$ruleName = 'PillCounter-Direct-LAN'
if (-not (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name $ruleName -DisplayName '알약 카운터 PC 직접 연결 (개인망)' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8443,8444 -RemoteAddress LocalSubnet -Profile Private | Out-Null
}
Write-Host '개인 네트워크의 같은 서브넷에서 8443/8444 포트를 허용했어요.'
