# 只读检查；不会修改配置、安装包、数据库或启动/关闭进程。不读取令牌和聊天内容。
$ErrorActionPreference='Stop'
$taskCandidates=@(
  @{label='插件目录';path=(Join-Path $env:USERPROFILE '.dsh\plugins\qq-bot-suite')},
  @{label='DSH依赖目录';path=(Join-Path $env:USERPROFILE '.dsh\node_modules\qq-bot-suite')},
  @{label='当前包';path=([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')))}
)
$taskResults=@()
$taskDevBridge=''
$taskDevConfig=Join-Path $env:USERPROFILE '.dsh\qq-bot-suite\config.json'
if(Test-Path -LiteralPath $taskDevConfig){try{$taskDevBridge=[string](Get-Content -LiteralPath $taskDevConfig -Raw|ConvertFrom-Json).devBridgeDir}catch{}}
foreach($taskCandidate in $taskCandidates){
  $taskManifest=Join-Path $taskCandidate.path 'package.json'
  if(!(Test-Path -LiteralPath $taskManifest)){continue}
  try {
    $taskPkg=Get-Content -LiteralPath $taskManifest -Raw|ConvertFrom-Json
    if($taskPkg.name -ne 'qq-bot-suite'){continue}
    $taskClient=Join-Path $taskCandidate.path 'client.js';$taskUi=if(Test-Path -LiteralPath $taskClient){Get-Content -LiteralPath $taskClient -Raw}else{''}
    $taskUiVersion=if($taskUi -match "UI_VERSION\s*=\s*'([^']+)'"){$Matches[1]}else{'未标记（旧界面）'}
    $taskBridgeRoot=if($taskDevBridge -and (Test-Path -LiteralPath (Join-Path $taskDevBridge 'qqbot-guard.vbs'))){$taskDevBridge}else{Join-Path $taskCandidate.path 'bridge'}
    $taskEntry=Join-Path $taskBridgeRoot 'src\memory-tree-extensions.js';$taskExt=if(Test-Path -LiteralPath $taskEntry){Get-Content -LiteralPath $taskEntry -Raw}else{''}
    $taskResults+=[pscustomobject]@{位置=$taskCandidate.label;目录=$taskCandidate.path.Replace($env:USERPROFILE,'%USERPROFILE%');插件版本=$taskPkg.version;界面版本=$taskUiVersion;记忆树界面=$taskUi.Contains('function MemoryManager(');好感度界面=$taskUi.Contains('人物好感度');批量审核界面=$taskUi.Contains('批量审核');外部桥接覆盖=[bool]$taskDevBridge;好感度后端=(Test-Path -LiteralPath (Join-Path $taskBridgeRoot 'src\affinity.js'));批量审核后端=$taskExt.Contains("action==='batchReview'");界面SHA256=if(Test-Path -LiteralPath $taskClient){(Get-FileHash -LiteralPath $taskClient -Algorithm SHA256).Hash}else{''}}
  }catch{$taskResults+=[pscustomobject]@{位置=$taskCandidate.label;错误='无法读取插件清单或界面文件'}}
}
if(!$taskResults.Count){Write-Output '常见安装目录中没有找到 qq-bot-suite。请在DSH插件详情查看实际安装位置。'}else{$taskResults|ConvertTo-Json -Depth 4}
Write-Output '若磁盘界面完整但DSH未显示，请核对DSH实际安装位置是否为上述目录；不要删除state、config.json或重新初始化账号。'
