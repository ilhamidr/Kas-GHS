Add-Type -AssemblyName System.IO.Compression.FileSystem

$path = 'D:\aa\GHS\project\KAS GRIYA HASANAH SUKAASIH.xlsx'
$zip = [System.IO.Compression.ZipFile]::OpenRead($path)

$targets = @('xl/worksheets/sheet1.xml','xl/worksheets/sheet2.xml','xl/worksheets/sheet3.xml','xl/worksheets/sheet7.xml','xl/worksheets/sheet8.xml','xl/worksheets/sheet9.xml')
foreach ($t in $targets) {
    $entry = $zip.GetEntry($t)
    if ($null -ne $entry) {
        $reader = New-Object System.IO.StreamReader($entry.Open())
        $content = $reader.ReadToEnd()
        $reader.Close()
        $outFile = 'D:\aa\GHS\project\sheets\' + ($t -replace 'xl/worksheets/','') -replace '.xml','.xml'
        [System.IO.Directory]::CreateDirectory('D:\aa\GHS\project\sheets') | Out-Null
        [System.IO.File]::WriteAllText($outFile, $content)
        Write-Output ("Wrote: " + $outFile + "  (" + $content.Length + " chars)")
    }
}
$zip.Dispose()
