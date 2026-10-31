import {createContext,useContext} from 'react';
export type AppearanceMode='light'|'dark'|'system';
export const APPEARANCE_KEY='chat3d.appearance.v1';
export const parseAppearance=(value:unknown):AppearanceMode=>value==='dark'||value==='system'?value:'light';
export const appearanceLabels={light:'浅色',dark:'深色',system:'跟随系统'};
export interface AppearanceState{mode:AppearanceMode;resolved:'light'|'dark';setMode:(mode:AppearanceMode)=>void;storageError:boolean}
export const AppearanceContext=createContext<AppearanceState>({mode:'light',resolved:'light',setMode:()=>{},storageError:false});
export const useAppearance=()=>useContext(AppearanceContext);
