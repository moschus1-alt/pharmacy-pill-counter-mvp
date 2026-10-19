$ErrorActionPreference = 'Stop'
try {
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'Windows 64비트가 필요해요.' }
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $configPath = Join-Path $PSScriptRoot 'connection.json'
    $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($config.apiUrl -ne 'https://pharmacy-pill-counter-mvp.vercel.app/api/print-relay' -or
        $config.stationId -notmatch '^\d{13}-[a-f0-9]{32}$' -or
        $config.ownerToken -notmatch '^[a-f0-9]{64}$') { throw '연결 파일을 다시 받아 주세요.' }
    if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $config.expiresAt) { throw '연결이 만료됐어요. PC 웹 화면에서 새 연결 파일을 받아 주세요.' }
    $form = New-Object Windows.Forms.Form
    $form.Text = '알약 카운터 · 자동 출력'; $form.Width = 490; $form.Height = 210
    $form.StartPosition = 'CenterScreen'
    $label = New-Object Windows.Forms.Label
    $label.Text = '이 PC에 설치된 라벨프린터를 선택하세요.'; $label.SetBounds(20,20,440,25)
    $select = New-Object Windows.Forms.ComboBox
    $select.DropDownStyle = 'DropDownList'; $select.SetBounds(20,55,430,30)
    foreach ($name in [Drawing.Printing.PrinterSettings]::InstalledPrinters) { [void]$select.Items.Add($name) }
    if ($select.Items.Count -eq 0) { throw '설치된 프린터가 없어요. Windows에서 라벨프린터 드라이버를 먼저 설치해 주세요.' }
    for ($i=0; $i -lt $select.Items.Count; $i++) { if ($select.Items[$i] -match 'QL-550') { $select.SelectedIndex=$i; break } }
    $button = New-Object Windows.Forms.Button
    $button.Text = '자동 출력 시작'; $button.SetBounds(250,105,200,35)
    $button.Add_Click({ if ($select.SelectedIndex -ge 0) { $form.DialogResult = 'OK'; $form.Close() } })
    $form.Controls.AddRange(@($label,$select,$button))
    if ($form.ShowDialog() -ne 'OK') { exit 0 }
    $printer = [string]$select.SelectedItem
    $form.Dispose()
    # Private portable runtime: no Python installation, admin rights or PATH edits.
    $runtime = Join-Path $env:LOCALAPPDATA 'PillCounter\python-3.13.7'
    $python = Join-Path $runtime 'python.exe'
    if (-not (Test-Path -LiteralPath $python)) {
        Write-Host '최초 실행 준비 중… (Python 공식 서버에서 실행 구성요소를 받아요.)'
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $temp = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
        [void](New-Item -ItemType Directory -Path $temp)
        try {
            $archive = Join-Path $temp 'python.zip'
            Invoke-WebRequest -UseBasicParsing -Uri 'https://www.python.org/ftp/python/3.13.7/python-3.13.7-embed-amd64.zip' -OutFile $archive
            if ((Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash -ne 'F6CCA216A359BE84797CABB54149CE5E062AFB16CC7567EB7FC51CACB2D86B65') { throw '실행 구성요소 검증에 실패했어요.' }
            $expanded = Join-Path $temp 'runtime'
            Expand-Archive -LiteralPath $archive -DestinationPath $expanded
            [void](New-Item -ItemType Directory -Force -Path (Split-Path $runtime))
            Move-Item -LiteralPath $expanded -Destination $runtime
        } finally { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue }
    }
    & $python (Join-Path $PSScriptRoot 'receiver.py') $configPath $printer
} catch {
    Write-Host $_.Exception.Message
    exit 1
}
