Add-Type -AssemblyName System.IO.Compression.FileSystem

$path = 'D:\aa\GHS\project\KAS GRIYA HASANAH SUKAASIH.xlsx'
$zip = [System.IO.Compression.ZipFile]::OpenRead($path)

$targets = @('xl/workbook.xml', 'xl/sharedStrings.xml', 'xl/_rels/workbook.xml.rels')
foreach ($t in $targets) {
    $entry = $zip.GetEntry($t)
    if ($null -ne $entry) {
        $reader = New-Object System.IO.StreamReader($entry.Open())
        $content = $reader.ReadToEnd()
        $reader.Close()
        $outFile = 'D:\aa\GHS\project\' + ($t -replace '/', '_')
        [System.IO.File]::WriteAllText($outFile, $content)
        Write-Output ("Wrote: " + $outFile + "  (" + $content.Length + " chars)")
    } else {
        Write-Output ("MISSING: " + $t)
    }
}
$zip.Dispose()
