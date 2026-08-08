Add-Type -AssemblyName System.IO.Compression.FileSystem

$path = 'D:\aa\GHS\project\KAS GRIYA HASANAH SUKAASIH.xlsx'
$zip = [System.IO.Compression.ZipFile]::OpenRead($path)
Write-Output "===== ZIP ENTRIES ====="
$zip.Entries | ForEach-Object { Write-Output ("{0}`t{1}" -f $_.FullName, $_.Length) }
$zip.Dispose()
