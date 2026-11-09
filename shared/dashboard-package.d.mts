export type DashboardPackage={fileName:string;entry:string;files:Record<string,Uint8Array>};
export function decodeDashboardPackage(pack:DashboardPackage):Record<string,Uint8Array>;
export function dashboardMime(path:string):string;
export function dashboardPath(path:string,directory?:boolean):string;
