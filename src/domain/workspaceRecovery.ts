export function workspaceRecovery(error:string){
 if(/另一个标签页|其他页面占用|跨标签|其他标签页/.test(error))return {kind:'conflict' as const,refresh:true,guidance:'先下载本页备份，关闭其他标签页后刷新；本页不会覆盖其他页面的数据。'};
 if(/空间不足|空间已满|quota/i.test(error))return {kind:'quota' as const,refresh:false,guidance:'先下载工作台备份和资产库备份并确认文件已保存，再清理设备空间或不再需要的浏览器数据后重试。不要在未备份时清除本应用数据。'};
 if(/数据无法写入|DataCloneError/.test(error))return {kind:'data' as const,refresh:false,guidance:'请先下载备份并保留当前页面。若重新打开项目后仍无法写入，请保留备份并联系支持。'};
 if(/不完整|恢复失败/.test(error))return {kind:'recovery' as const,refresh:false,guidance:'已有数据不会被覆盖。请保留当前可下载的备份，再通过“备份与恢复”导入完整项目备份。'};
 return {kind:'write' as const,refresh:false,guidance:'请先下载备份，检查浏览器是否允许本地存储、设备可用空间及隐私模式限制，恢复写入条件后重新打开应用。'};
}
export function workspaceSaveError(error:string){return `${error} ${workspaceRecovery(error).guidance}`;}
