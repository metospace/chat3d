export type BlenderExecutionStage='starting'|'executing'|'saving'|'exporting'|'rendering'|'reading'|'completed';
export interface BlenderExecutionProgress {stage:BlenderExecutionStage;message:string}
export interface BlenderActivityProgress {
 stage:'receiving'|BlenderExecutionStage|'reviewing'|'failed';
 instruction:string;
 script:string;
 receivedChars:number;
 updatedAt:number;
 events:{stage:BlenderActivityProgress['stage'];message:string;at:number}[];
}
