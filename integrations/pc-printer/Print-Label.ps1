param([Parameter(Mandatory=$true)][string]$LabelPath, [Parameter(Mandatory=$true)][string]$PrinterName)
$ErrorActionPreference = 'Stop'
$started = $false; $doc = $null; $bitmap = $null; $g = $null
$fonts = @(); $format = $null
try {
    Add-Type -AssemblyName System.Drawing
    . (Join-Path $PSScriptRoot 'Barcode.ps1')
    $data = Get-Content -LiteralPath $LabelPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $sizes = @{'60x40'=@(60,40);'70x50'=@(70,50);'50x30'=@(50,30);'62x29'=@(62,29);'62x100'=@(62,100);'29x90'=@(29,90)}
    if ($data.size -eq 'custom' -or $data.size -eq 'dk22210') { $width=[double]$data.widthMm; $height=[double]$data.heightMm }
    elseif ($sizes.ContainsKey($data.size)) { $width=$sizes[$data.size][0]; $height=$sizes[$data.size][1] }
    else { throw 'layout' }
    if ($width -lt 12 -or $width -gt 200 -or $height -lt 12 -or $height -gt 200 -or
        ($data.size -eq 'dk22210' -and $width -ne 29) -or $data.copies -lt 1 -or $data.copies -gt 20) { throw 'layout' }
    $dpi = 300; $scale = $dpi / 25.4; $padding = 2 * $scale; $verticalPadding = 3 * $scale
    $bitmap = New-Object Drawing.Bitmap ([int][Math]::Round($width*$scale)),([int][Math]::Round([Math]::Max($height,200)*$scale))
    $bitmap.SetResolution($dpi,$dpi)
    $g = [Drawing.Graphics]::FromImage($bitmap); $g.Clear([Drawing.Color]::White)
    $g.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $contentWidth = $bitmap.Width - 2*$padding
    function Render-Content([double]$ratio) {
        $g.Clear([Drawing.Color]::White)
        $normal = New-Object Drawing.Font 'Malgun Gothic',([single](7*$ratio))
        $bold = New-Object Drawing.Font 'Malgun Gothic',([single](9*$ratio)),([Drawing.FontStyle]::Bold)
        $fonts = @($normal,$bold)
        $ink = [Drawing.Brushes]::Black
        $contentWidth = $bitmap.Width - 2*$padding
        $script:y = $verticalPadding
        function Write-Line([string]$text, [Drawing.Font]$font) {
            if (-not $text) { return }
            $measure = $g.MeasureString($text,$font,[int]$contentWidth)
            $rect = New-Object Drawing.RectangleF ([single]$padding),([single]$script:y),([single]$contentWidth),([single]($measure.Height+1))
            $g.DrawString($text,$font,$ink,$rect)
            $script:y += $measure.Height + 2*$ratio
        }
        Write-Line ('의약품 예제소분 · '+$data.count+'개') $normal
        $name = [string]$data.name
        do { $old=$name; $name=[regex]::Replace($name,'\([^()]*\)|（[^（）]*）','') } while ($name -ne $old)
        $name = [regex]::Replace($name.Replace('_',' '),'\s+',' ').Trim()
        $lineHeight = $bold.GetHeight($g) + 3*$ratio
        $format = New-Object Drawing.StringFormat
        $format.FormatFlags = [Drawing.StringFormatFlags]::NoWrap
        $format.Trimming = [Drawing.StringTrimming]::EllipsisCharacter
        $rect = New-Object Drawing.RectangleF ([single]$padding),([single]$script:y),([single]$contentWidth),([single]$lineHeight)
        $g.DrawString($name,$bold,$ink,$rect,$format); $script:y += $lineHeight+3*$ratio
        Write-Line ([string]$data.strength) $normal
        if ($data.lot) { Write-Line ('제조번호 '+$data.lot) $normal }
        Write-Line ('소분일 '+$data.packedOn) $normal
        if ($data.expiry) { Write-Line ('제품 사용기한 '+$data.expiry) $normal }
        if ($data.useBy) { Write-Line ('소분 후 사용기한 '+$data.useBy) $normal }
        $modules = Get-BarcodeModules ([string]$data.code)
        $unit = [int][Math]::Floor($contentWidth / $modules.Length)
        $unit = [Math]::Min([Math]::Max(1,$unit),$contentWidth/$modules.Length)
        $barHeight = 6*$scale*$ratio
        $script:y += 3*$ratio
        $left = $padding + [Math]::Floor(($contentWidth-$unit*$modules.Length)/2)
        for ($i=0; $i -lt $modules.Length; $i++) {
            if ($modules[$i] -eq '1') { $g.FillRectangle($ink,[single]($left+$i*$unit),[single]$script:y,[single]$unit,[single]$barHeight) }
        }
        $script:y += $barHeight+3*$ratio
        Write-Line ([string]$data.code) $normal
        foreach ($font in $fonts) { $font.Dispose() }
        $format.Dispose()
        return $script:y-$verticalPadding
    }
    $contentHeight=Render-Content 1
    $availableHeight=$height*$scale-2*$verticalPadding
    if ($contentHeight -gt $availableHeight) {
        $low=.01; $high=1
        for ($iteration=0; $iteration -lt 14; $iteration++) {
            $middle=($low+$high)/2
            if ((Render-Content $middle) -le $availableHeight) { $low=$middle } else { $high=$middle }
        }
        $contentHeight=Render-Content $low
    }
    $targetWidth=$contentWidth/$scale; $targetHeight=$contentHeight/$scale
    $g.Dispose(); $g=$null
    $doc = New-Object Drawing.Printing.PrintDocument
    $doc.PrinterSettings.PrinterName = $PrinterName
    $doc.PrinterSettings.Copies = 1
    if (-not $doc.PrinterSettings.IsValid) { throw 'printer' }
    $doc.PrintController = New-Object Drawing.Printing.StandardPrintController
    $doc.DocumentName = 'Pill Counter label'
    $doc.DefaultPageSettings.Landscape = $false
    $doc.DefaultPageSettings.Margins = New-Object Drawing.Printing.Margins 0,0,0,0
    $paper = New-Object Drawing.Printing.PaperSize 'Pill Counter',([int][Math]::Round($width/25.4*100)),([int][Math]::Round($height/25.4*100))
    $doc.DefaultPageSettings.PaperSize = $paper
    # The printer may silently substitute a different form. Reject before StartDoc.
    $measurement = $doc.PrinterSettings.CreateMeasurementGraphics($doc.DefaultPageSettings)
    $measurement.Dispose()
    $page = $doc.DefaultPageSettings
    if ([Math]::Abs($page.Bounds.Width-$paper.Width) -gt 4 -or [Math]::Abs($page.Bounds.Height-$paper.Height) -gt 4 -or
        $page.PrintableArea.Width -lt $paper.Width-16 -or $page.PrintableArea.Height -lt $paper.Height-24) { throw 'layout' }
    $script:remaining = [int]$data.copies
    $script:pageError = $null
    $doc.add_PrintPage({ param($sender,$event)
        try {
            if ([Math]::Abs($event.PageBounds.Width-$paper.Width) -gt 4 -or [Math]::Abs($event.PageBounds.Height-$paper.Height) -gt 4) { throw 'layout' }
            $event.Graphics.PageUnit = [Drawing.GraphicsUnit]::Millimeter
            $event.Graphics.TranslateTransform(-$event.PageSettings.HardMarginX*25.4/100,-$event.PageSettings.HardMarginY*25.4/100)
            $target = New-Object Drawing.RectangleF ([single](($width-$targetWidth)/2)),3,([single]$targetWidth),([single]$targetHeight)
            $source = New-Object Drawing.RectangleF ([single]$padding),([single]$verticalPadding),([single]$contentWidth),([single]$contentHeight)
            $event.Graphics.DrawImage($bitmap,$target,$source,[Drawing.GraphicsUnit]::Pixel)
            $script:remaining--; $event.HasMorePages = $script:remaining -gt 0
        } catch { $script:pageError='uncertain'; $event.Cancel=$true; $event.HasMorePages=$false }
    })
    $started=$true; $doc.Print()
    if ($script:pageError -or $script:remaining -ne 0) { throw 'uncertain' }
    Write-Output 'SPOOLED'
} catch {
    if (-not $started) { exit 2 }
    exit 3
} finally {
    if ($g) { $g.Dispose() }
    if ($doc) { $doc.Dispose() }
    if ($bitmap) { $bitmap.Dispose() }
    foreach ($font in $fonts) { $font.Dispose() }
    if ($format) { $format.Dispose() }
}
