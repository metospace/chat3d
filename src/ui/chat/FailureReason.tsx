import {sanitizeDiagnostic} from '../../ai/runTraceLog';

export function FailureReason({reason,apiKey}:{reason:string;apiKey?:string}){
 return <details className="adx-failure-reason"><summary>失败原因</summary><pre>{sanitizeDiagnostic(reason,apiKey)}</pre></details>;
}
