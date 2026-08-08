Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Web.Extensions

$path = 'D:\aa\GHS\project\KAS GRIYA HASANAH SUKAASIH.xlsx'
$zip = [System.IO.Compression.ZipFile]::OpenRead($path)

# Sheet name mapping based on workbook.xml
$sheetMap = @{
    'xl/worksheets/sheet1.xml' = 'DB_WARGA'
    'xl/worksheets/sheet2.xml' = 'DB_IURAN'
    'xl/worksheets/sheet3.xml' = 'DB_JIMPITAN'
    'xl/worksheets/sheet4.xml' = 'DB_RONDA'
    'xl/worksheets/sheet5.xml' = 'DB_KERJA_BAKTI'
    'xl/worksheets/sheet6.xml' = 'DB_TUNGGAKAN'
    'xl/worksheets/sheet7.xml' = 'DB_REKAP_PEMASUKAN'
    'xl/worksheets/sheet8.xml' = 'DB_REKAP_PENGELUARAN'
    'xl/worksheets/sheet9.xml' = 'SUMMARY'
}

# Read shared strings
function Get-SharedStrings {
    $entry = $zip.GetEntry('xl/sharedStrings.xml')
    $reader = New-Object System.IO.StreamReader($entry.Open())
    $content = $reader.ReadToEnd()
    $reader.Close()
    # Parse all <t>...</t> values
    $matches = [regex]::Matches($content, '<t[^>]*>(.*?)</t>')
    $strings = @()
    foreach ($m in $matches) {
        $val = $m.Groups[1].Value
        $strings += $val
    }
    return ,$strings
}

# Read a worksheet and return rows of cell objects
function Get-SheetRows {
    param($sheetXml)
    $rows = @()
    $rowMatches = [regex]::Matches($sheetXml, '<row r="(\d+)"[^>]*>(.*?)</row>')
    foreach ($rm in $rowMatches) {
        $rowNum = [int]$rm.Groups[1].Value
        $cellsXml = $rm.Groups[2].Value
        $cells = @()
        $cellMatches = [regex]::Matches($cellsXml, '<c r="([A-Z]+)(\d+)"([^>]*)>(.*?)</c>')
        foreach ($cm in $cellMatches) {
            $col = $cm.Groups[1].Value
            $attrs = $cm.Groups[3].Value
            $inner = $cm.Groups[4].Value
            $cell = @{ col = $col; value = '' }
            if ($attrs -match 't="s"') {
                # shared string
                $vMatch = [regex]::Match($inner, '<v>([^<]*)</v>')
                if ($vMatch.Success) {
                    $idx = [int]$vMatch.Groups[1].Value
                    $cell.value = $script:sharedStrings[$idx]
                }
            } elseif ($inner -match '<v>([^<]*)</v>') {
                $cell.value = $Matches[1]
            }
            # If cell has no explicit value but has style reference, keep empty
            $cells += $cell
        }
        $rows += @{ row = $rowNum; cells = $cells }
    }
    return ,$rows
}

$script:sharedStrings = Get-SharedStrings
Write-Output ("Shared strings: " + $script:sharedStrings.Count)

$result = @{}
foreach ($entry in $zip.Entries) {
    if ($sheetMap.ContainsKey($entry.FullName)) {
        $reader = New-Object System.IO.StreamReader($entry.Open())
        $xml = $reader.ReadToEnd()
        $reader.Close()
        $rows = Get-SheetRows -sheetXml $xml
        $result[$sheetMap[$entry.FullName]] = $rows
        Write-Output ("Parsed " + $sheetMap[$entry.FullName] + ": " + $rows.Count + " rows")
    }
}
$zip.Dispose()

# Convert to JSON
$serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$json = $serializer.Serialize($result)
[System.IO.File]::WriteAllText('D:\aa\GHS\project\data.json', $json)
Write-Output "Done. JSON written to data.json"
