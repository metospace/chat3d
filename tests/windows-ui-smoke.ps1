$ErrorActionPreference = 'Stop'
$teamBase = if($env:CHAT3D_TEAM_SMOKE_URL){$env:CHAT3D_TEAM_SMOKE_URL}else{'http://127.0.0.1'}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class SmokeMouse {
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra);
}
'@
$out = Join-Path $PWD 'windows-smoke-results'
New-Item $out -ItemType Directory -Force | Out-Null
$checks = [System.Collections.Generic.List[object]]::new()
$app = $null; $window = $null; $failure = $null
function Shot($name) {
 $r=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds
 $b=New-Object System.Drawing.Bitmap($r.Width,$r.Height); $g=[System.Drawing.Graphics]::FromImage($b)
 try { $g.CopyFromScreen($r.Location,[System.Drawing.Point]::Empty,$r.Size); $b.Save((Join-Path $out "$name.png")) } finally { $g.Dispose();$b.Dispose() }
}
function Find-Control($name,[switch]$AllowDisabled,[switch]$NamePrefixMatch) {
 $condition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,$name)
 for($i=0;$i -lt 30;$i++) {
  $all=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
  $matches=@($all | Where-Object { $_.Current.Name -eq $name })
  $preferred=$matches | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -or $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::MenuItem -or $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Hyperlink } | Select-Object -First 1
  $found= if($preferred){$preferred} else { $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition) }
  if($found -and ($AllowDisabled -or $found.Current.IsEnabled)){return $found}
  if($NamePrefixMatch) {
   $found=$all | Where-Object {
    ($_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -or $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::MenuItem) -and
    $_.Current.Name.StartsWith($name) -and
    ($AllowDisabled -or $_.Current.IsEnabled)
   } | Select-Object -First 1
   if($found){return $found}
  }
  Start-Sleep -Milliseconds 500
 }
 throw "UI control not found: $name"
}
function Click-Control($name,[switch]$NamePrefixMatch) {
 Write-Host "Click UI: $name"
 $element=Find-Control $name -NamePrefixMatch:$NamePrefixMatch
 try { $point=$element.GetClickablePoint() } catch { $element.SetFocus();Start-Sleep -Milliseconds 300;$point=$element.GetClickablePoint() }
 Write-Host "Pointer target $name at $($point.X),$($point.Y), type $($element.Current.ControlType.ProgrammaticName)"
 [SmokeMouse]::SetCursorPos([int]$point.X,[int]$point.Y) | Out-Null
 Start-Sleep -Milliseconds 150
 [SmokeMouse]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
 Start-Sleep -Milliseconds 100
 [SmokeMouse]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
 Start-Sleep -Milliseconds 700
}
function Set-Input($name,$value) {
 Write-Host "Set UI input: $name"
 $all=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
 $edit=$all | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and ($_.Current.Name -eq $name -or $_.Current.Name.StartsWith($name)) } | Select-Object -First 1
 if(!$edit){throw "Input missing: $name"}
 try { $point=$edit.GetClickablePoint(); [SmokeMouse]::SetCursorPos([int]$point.X,[int]$point.Y) | Out-Null; Start-Sleep -Milliseconds 100; [SmokeMouse]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 80; [SmokeMouse]::mouse_event(4,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 150 } catch { $edit.SetFocus(); Start-Sleep -Milliseconds 200 }
 [System.Windows.Forms.SendKeys]::SendWait('^a'); Start-Sleep -Milliseconds 80
 [System.Windows.Forms.SendKeys]::SendWait($value); Start-Sleep -Milliseconds 250
 try {
  $vp=$edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  if($vp.Current.Value -ne $value){ $vp.SetValue($value); Start-Sleep -Milliseconds 200; [System.Windows.Forms.SendKeys]::SendWait('{END}'); [System.Windows.Forms.SendKeys]::SendWait(' '); [System.Windows.Forms.SendKeys]::SendWait('{BACKSPACE}'); Start-Sleep -Milliseconds 150 }
 } catch {}
 [System.Windows.Forms.SendKeys]::SendWait('{TAB}'); Start-Sleep -Milliseconds 500
}
function Wait-ControlEnabled($name,$timeoutSec=20) {
 $deadline=(Get-Date).AddSeconds($timeoutSec)
 while((Get-Date) -lt $deadline) {
  $all=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
  $hit=$all | Where-Object { $_.Current.Name -eq $name -and $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.IsEnabled } | Select-Object -First 1
  if($hit){return $hit}
  Start-Sleep -Milliseconds 400
 }
 Dump-Controls 'ui-wait-enabled-controls'
 throw "UI control stayed disabled: $name"
}
function Dump-Controls($name) {
 $all=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
 @($all | ForEach-Object { @{name=$_.Current.Name; type=$_.Current.ControlType.ProgrammaticName; enabled=$_.Current.IsEnabled} }) | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $out "$name.json")
}
function Assert-ControlMissing($name) {
 $all=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
 $hit=$all | Where-Object { $_.Current.Name -eq $name } | Select-Object -First 1
 if($hit){throw "UI control unexpectedly present: $name ($($hit.Current.ControlType.ProgrammaticName))"}
}
function Wait-ControlAbsent($name,$timeoutSec=20) {
 $deadline=(Get-Date).AddSeconds($timeoutSec)
 while((Get-Date) -lt $deadline) {
  $all=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
  $hit=$all | Where-Object { $_.Current.Name -eq $name } | Select-Object -First 1
  if(!$hit){return}
  Start-Sleep -Milliseconds 400
 }
 Dump-Controls 'ui-wait-absent-controls'
 throw "UI control stayed present: $name"
}
function Invoke-EnabledButton($name,$timeoutSec=25) {
 Write-Host "Invoke UI: $name"
 $element=Wait-ControlEnabled $name $timeoutSec
 try {
  $pattern=$element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $pattern.Invoke()
  Start-Sleep -Milliseconds 800
  return
 } catch {
  Write-Host "InvokePattern unavailable for $name; falling back to click"
 }
 Click-Control $name
}
function Wait-ControlPresent($name,$timeoutSec=45) {
 $deadline=(Get-Date).AddSeconds($timeoutSec)
 while((Get-Date) -lt $deadline) {
  $all=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
  $hit=$all | Where-Object { $_.Current.Name -eq $name -and ($_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -or $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text -or $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Hyperlink -or $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Group -or $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Custom -or $_.Current.IsEnabled) } | Select-Object -First 1
  if($hit){return $hit}
  Start-Sleep -Milliseconds 500
 }
 Dump-Controls 'ui-wait-present-controls'
 throw "UI control not found within timeout: $name"
}
try {
 # Prove the isolated server is reachable before testing the installed UI.
 $fixtureLogin=Invoke-RestMethod -Uri ($teamBase + '/api/team/login') -Method Post -ContentType 'application/json' -Body (@{name='smoke-bob';password='isolated-smoke-password-b'} | ConvertTo-Json)
 $fixtureHeaders=@{Authorization=('Bearer '+$fixtureLogin.token)}
 $fixtureRows=Invoke-RestMethod -Uri ($teamBase + '/api/team/items?kind=asset') -Headers $fixtureHeaders
 if(@($fixtureRows | Where-Object name -eq 'NativeTestBox').Count -ne 1){throw 'Isolated team fixture asset missing'}
 Invoke-RestMethod -Uri ($teamBase + '/api/team/logout') -Method Post -ContentType 'application/json' -Headers $fixtureHeaders -Body '{}' | Out-Null
 Write-Host 'Isolated server authentication and asset readiness verified'
 $app=Start-Process $env:CHAT3D_INSTALLED_EXE -PassThru
 for($i=0;$i -lt 30;$i++) { $app.Refresh(); if($app.MainWindowHandle -ne 0){break};Start-Sleep -Seconds 1 }
 if($app.HasExited -or $app.MainWindowHandle -eq 0){throw 'Installed app failed to create window'}
 $window=[System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
 $windowPattern=$window.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
 $windowPattern.SetWindowVisualState([System.Windows.Automation.WindowVisualState]::Maximized)
 Start-Sleep -Seconds 2
 Start-Sleep -Seconds 4;Shot 'ui-home';Dump-Controls 'ui-home-controls'
 Find-Control '资产库' | Out-Null
 $checks.Add(@{name='installed app home renders with accessible navigation';pass=$true})
 Click-Control '团队库';Find-Control '登录授权' | Out-Null;Shot 'ui-team-page';Dump-Controls 'ui-team-page-controls'
 $checks.Add(@{name='team library page opens from navigation';pass=$true})
 # #66+: unauthenticated team library is login-only — no asset/scene tabs or local password form.
 Assert-ControlMissing '团队资产'
 Assert-ControlMissing '团队场景'
 Assert-ControlMissing '团队账号'
 Assert-ControlMissing '团队密码'
 Assert-ControlMissing '团队服务地址'
 Assert-ControlMissing '服务地址已固定为门户地址，不可修改'
 Find-Control '登录授权' | Out-Null
 Find-Control '登录，连接你的团队' | Out-Null
 $checks.Add(@{name='team library login-only until authenticated (SSO 登录授权; no asset/scene tabs or password form)';pass=$true})
Click-Control '继续使用本地资源'

Click-Control '资产库'
 Click-Control '新建资产';Find-Control '导出与更多' | Out-Null;Shot 'ui-workbench'
 $checks.Add(@{name='new asset opens workbench';pass=$true})
 Click-Control '导出与更多';Shot 'ui-export-menu';Dump-Controls 'ui-export-controls';Click-Control '备份与恢复';Shot 'ui-after-menu-selection';Find-Control '下载工作台备份' | Out-Null
 $downloads=(New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path
 $folder=Join-Path $downloads 'Scenivo'
 $before=@(Get-ChildItem $folder -Filter 'scenivo-workspace-*.json' -ErrorAction SilentlyContinue | ForEach-Object FullName)
 $saved=@()
 for($repeat=0;$repeat -lt 2;$repeat++) {
  Click-Control '下载工作台备份'
  $new=$null
  for($i=0;$i -lt 30;$i++) { $new=Get-ChildItem $folder -Filter 'scenivo-workspace-*.json' -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notin $before -and $_.FullName -notin $saved } | Select-Object -First 1;if($new){break};Start-Sleep -Milliseconds 500 }
  if(!$new){throw 'Native backup click did not produce a new file'}
  $data=Get-Content $new.FullName -Raw | ConvertFrom-Json
  if($data.format -ne 'chat3d-workspace-backup'){throw 'Saved backup format mismatch'}
  $saved+= $new.FullName
 }
 if($saved[0] -eq $saved[1]){throw 'Repeated export overwrote file'}
 Shot 'ui-backup-saved';Dump-Controls 'ui-backup-controls'
 $checks.Add(@{name='real backup button writes two distinct valid JSON files';pass=$true;files=$saved})
 [System.Windows.Forms.SendKeys]::SendWait('{ESC}');Start-Sleep -Seconds 1
 Click-Control '连接模型' -NamePrefixMatch
 Set-Input 'API 根地址' 'https://smoke-test.invalid/v1'
 Set-Input 'API Key' 'smoke-test-not-a-secret'
 Click-Control '服务不提供列表？手动填写模型名'
 Set-Input '手动模型名' 'smoke-test'
 Invoke-EnabledButton '保存配置' 25
 Wait-ControlAbsent '连接并选择模型' 25
 Assert-ControlMissing '连接并选择模型'
 Set-Input '建模指令' 'Create one simple box for the synthetic failure test'
 Click-Control '发送'
 Start-Sleep -Seconds 3
 Click-Control '本项目任务记录'
 Wait-ControlPresent '问题排查' 60 | Out-Null
 Click-Control '问题排查'
 Find-Control '下载脱敏诊断记录' | Out-Null
 $diagnosticBefore=@(Get-ChildItem $folder -Filter 'scenivo-diagnostics-*.json' -ErrorAction SilentlyContinue | ForEach-Object FullName)
 Click-Control '下载脱敏诊断记录'
 $diagnostic=$null
 for($i=0;$i -lt 30;$i++){ $diagnostic=Get-ChildItem $folder -Filter 'scenivo-diagnostics-*.json' -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notin $diagnosticBefore } | Select-Object -First 1;if($diagnostic){break};Start-Sleep -Milliseconds 500 }
 if(!$diagnostic){throw 'Diagnostic button did not save a file'}
 $diagnosticText=Get-Content $diagnostic.FullName -Raw
 $diagnosticData=$diagnosticText | ConvertFrom-Json
 if($diagnosticData.format -ne 'chat3d-diagnostics-v1'){throw 'Wrong diagnostics format'}
 if($diagnosticText.Contains('smoke-test-not-a-secret')){throw 'Diagnostic export leaked dummy API credential'}
 Shot 'ui-diagnostics-saved';Dump-Controls 'ui-diagnostics-controls'
 $checks.Add(@{name='diagnostic download button saves redacted JSON after synthetic network failure';pass=$true;file=$diagnostic.FullName})

} catch { $failure=$_.Exception.Message;try{Shot 'ui-failure';if($window){Dump-Controls 'ui-failure-controls'}}catch{};Write-Host "SMOKE FAILURE: $failure"
 foreach($diagnostic in @('ui-failure-controls.json','team-server.log','team-server-error.log')) { $path=Join-Path $out $diagnostic;if(Test-Path $path){Write-Host "DIAGNOSTIC $diagnostic";Get-Content $path | Write-Host} } }
finally {
 @{pass=($null -eq $failure);checks=$checks;error=$failure;finishedAt=[DateTime]::UtcNow.ToString('o');limitations=@('No real model service request','Diagnostic path uses an intentional .invalid endpoint failure, not successful real generation','CI graphics differ from user GPU')} | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $out 'ui-result.json')
 if($app -and !$app.HasExited){$app.CloseMainWindow() | Out-Null;Start-Sleep -Seconds 2;if(!$app.HasExited){$app.Kill()}}
}
if($failure){exit 1}
