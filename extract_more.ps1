Add-Type -AssemblyName System.IO.Compression.FileSystem

$path = 'D:\aa\GHS\project\KAS GRIYA HASANAH SUKAASIH.xlsx'
$zip = [System.IO.Compression.ZipFile]::OpenRead($path)

$targets = @('xl/worksheets/sheet4.xml','xl/worksheets/sheet5.xml','xl/worksheets/sheet6.xml')
foreach ($t in $targets) {
    $entry = $zip.GetEntry($t)
    if ($null -ne $entry) {
        $reader = New-Object System.IO.StreamReader($entry.Open())
        $content = $reader.ReadToEnd()
        $reader.Close()
        $outFile = 'D:\aa\GHS\project\sheets\' + ($t -replace 'xl/worksheets/','')
        [System.IO.File]::WriteAllText($outFile, $content)
        Write-Output ("Wrote: " + $outFile + "  (" + $content.Length + " chars)")
    }
}
$zip.Dispose()
