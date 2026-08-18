param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet("protect", "unprotect")]
    [string]$Operation
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security
$value = [Console]::In.ReadLine()
if ($null -eq $value) {
    throw "DPAPI input is required"
}

$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
if ($Operation -eq "protect") {
    $plainBytes = [System.Text.Encoding]::UTF8.GetBytes($value)
    $protectedBytes = [System.Security.Cryptography.ProtectedData]::Protect($plainBytes, $null, $scope)
    [Console]::Out.Write([Convert]::ToBase64String($protectedBytes))
    exit 0
}

$protectedBytes = [Convert]::FromBase64String($value)
$plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect($protectedBytes, $null, $scope)
[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($plainBytes))
