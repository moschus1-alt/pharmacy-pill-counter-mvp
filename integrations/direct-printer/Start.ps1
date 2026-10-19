$ErrorActionPreference = 'Stop'
try {
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'Windows 64비트가 필요해요.' }
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $addresses = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.AddressState -eq 'Preferred' -and $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' })
    if ($addresses.Count -eq 0) { throw '공유기에 연결된 PC의 사설 IPv4 주소를 찾지 못했어요.' }
    $form = New-Object Windows.Forms.Form
    $form.Text = '알약 카운터 · PC 직접 연결'; $form.Width = 520; $form.Height = 300
    $form.StartPosition = 'CenterScreen'
    $label = New-Object Windows.Forms.Label
    $label.Text = '라벨프린터와 휴대폰이 연결된 공유기의 PC 주소를 선택하세요.'; $label.SetBounds(20,20,470,40)
    $printer = New-Object Windows.Forms.ComboBox
    $printer.DropDownStyle = 'DropDownList'; $printer.SetBounds(20,65,460,30)
    foreach ($name in [Drawing.Printing.PrinterSettings]::InstalledPrinters) { [void]$printer.Items.Add($name) }
    if ($printer.Items.Count -eq 0) { throw 'Windows에 QL-550 프린터 드라이버를 먼저 설치해 주세요.' }
    for ($i=0; $i -lt $printer.Items.Count; $i++) { if ($printer.Items[$i] -match 'QL-550') { $printer.SelectedIndex=$i; break } }
    $network = New-Object Windows.Forms.ComboBox
    $network.DropDownStyle = 'DropDownList'; $network.SetBounds(20,115,460,30)
    foreach ($entry in $addresses) { [void]$network.Items.Add(($entry.IPAddress + ' · ' + $entry.InterfaceAlias)) }
    $network.SelectedIndex = 0
    $button = New-Object Windows.Forms.Button
    $button.Text = '직접 연결 시작'; $button.SetBounds(270,175,210,40)
    $button.Add_Click({ if ($printer.SelectedIndex -ge 0) { $form.DialogResult='OK'; $form.Close() } })
    $form.Controls.AddRange(@($label,$printer,$network,$button))
    if ($form.ShowDialog() -ne 'OK') { exit 0 }
    $chosenPrinter = [string]$printer.SelectedItem
    $chosenHost = [string]$addresses[$network.SelectedIndex].IPAddress
    $form.Dispose()
    $appDir = Join-Path $env:LOCALAPPDATA 'PillCounterDirect'
    [void](New-Item -ItemType Directory -Force -Path $appDir)
    # Protect persistent CA keys, pairing journals and private runtime from other users.
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe $appDir /inheritance:r /grant:r "${identity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'PC 인증서 저장 폴더를 보호하지 못했어요.' }
    $runtime = Join-Path $appDir 'python-3.13.7'
    $manifest = Get-Content (Join-Path $PSScriptRoot 'runtime-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($item in $manifest.files) {
        $path = Join-Path $PSScriptRoot ('runtime-assets\' + $item.name)
        if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $item.sha256) { throw '실행 구성요소 검증에 실패했어요. ZIP 파일을 다시 받아 주세요.' }
    }
    if (-not (Test-Path (Join-Path $runtime '.ready'))) {
        $temp = Join-Path $appDir ('runtime-' + [Guid]::NewGuid().ToString('N'))
        [void](New-Item -ItemType Directory -Path $temp)
        try {
            Expand-Archive -LiteralPath (Join-Path $PSScriptRoot 'runtime-assets\python-3.13.7-embed-amd64.zip') -DestinationPath $temp
            $site = Join-Path $temp 'Lib\site-packages'
            [void](New-Item -ItemType Directory -Force -Path $site)
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            foreach ($item in $manifest.files) {
                if ($item.name.EndsWith('.whl')) { [IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $PSScriptRoot ('runtime-assets\'+$item.name)), $site) }
            }
            [IO.File]::WriteAllText((Join-Path $temp 'python313._pth'), "python313.zip`r`n.`r`nLib\site-packages`r`nimport site`r`n", [Text.Encoding]::ASCII)
            & (Join-Path $temp 'python.exe') -c 'import cryptography,ssl,sqlite3'
            if ($LASTEXITCODE -ne 0) { throw 'PC 실행 구성요소를 초기화하지 못했어요.' }
            [IO.File]::WriteAllText((Join-Path $temp '.ready'),'1')
            if (Test-Path $runtime) { Remove-Item -LiteralPath $runtime -Recurse -Force }
            Move-Item -LiteralPath $temp -Destination $runtime
        } finally { if (Test-Path $temp) { Remove-Item -LiteralPath $temp -Recurse -Force } }
    }
    Write-Host 'Windows 방화벽 확인창이 나오면 공유기에 연결된 개인 네트워크에서 허용해 주세요.'
    Write-Host '연결되지 않으면 Firewall.cmd를 관리자 권한으로 한 번 실행하세요. 개인 네트워크의 같은 서브넷만 허용합니다.'
    & (Join-Path $runtime 'python.exe') (Join-Path $PSScriptRoot 'run_direct.py') --host $chosenHost --printer $chosenPrinter
} catch { Write-Host $_.Exception.Message; exit 1 }
