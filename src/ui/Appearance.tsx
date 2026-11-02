import {useEffect,useLayoutEffect,useState,type ReactNode} from 'react';
import {Select} from 'antd';
import {Button,Dropdown} from 'antd';
import {SunIcon,MoonIcon,DesktopIcon} from '@radix-ui/react-icons';
import {applyDesignTokens} from './theme/designTokens';
import {AppTheme} from './theme/AppTheme';
import {APPEARANCE_KEY,AppearanceContext,appearanceLabels as labels,parseAppearance,useAppearance,type AppearanceMode} from './appearanceContext';
export {APPEARANCE_KEY,parseAppearance,useAppearance,type AppearanceMode} from './appearanceContext';
export function AppearanceProvider({children}:{children:ReactNode}){
 const [mode,setModeState]=useState<AppearanceMode>(()=>{try{return parseAppearance(localStorage.getItem(APPEARANCE_KEY));}catch{return 'light';}});
 const [systemDark,setSystemDark]=useState(()=>typeof window.matchMedia==='function'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
 const [storageError,setStorageError]=useState(false);
 const resolved=mode==='system'?(systemDark?'dark':'light'):mode;
 useEffect(()=>{if(typeof window.matchMedia!=='function')return;const media=window.matchMedia('(prefers-color-scheme: dark)');const changed=()=>setSystemDark(media.matches);changed();media.addEventListener('change',changed);return()=>media.removeEventListener('change',changed);},[]);
 useLayoutEffect(()=>{applyDesignTokens(resolved);document.documentElement.dataset.appearance=resolved;document.documentElement.classList.toggle("dark",resolved==="dark");document.documentElement.classList.toggle("light",resolved==="light");document.documentElement.style.colorScheme=resolved;},[resolved]);
 useEffect(()=>{const changed=(event:StorageEvent)=>{if(event.key===APPEARANCE_KEY||event.key===null){setModeState(parseAppearance(event.newValue));setStorageError(false);}};window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);},[]);
 const setMode=(value:AppearanceMode)=>{setModeState(value);try{localStorage.setItem(APPEARANCE_KEY,value);setStorageError(false);}catch{setStorageError(true);}};
 return <AppearanceContext.Provider value={{mode,resolved,setMode,storageError}}><div className={`radix-themes ${resolved}`} style={{height:'100%'}}><AppTheme>{children}</AppTheme></div></AppearanceContext.Provider>;
}
export function AppearanceMenu(){const {mode,resolved,setMode}=useAppearance();const Icon=mode==='system'?DesktopIcon:resolved==='dark'?MoonIcon:SunIcon;return <Dropdown trigger={['click']} placement="bottomRight" menu={{items:Object.entries(labels).map(([value,label])=>({key:value,label})),selectable:true,selectedKeys:[mode],onClick:({key})=>setMode(parseAppearance(key))}}><Button type="text" className="appearance-menu" aria-label={`切换外观，当前${labels[mode]}`} title={`外观：${labels[mode]}`} icon={<Icon/>}>{labels[mode]}</Button></Dropdown>;}
export function AppearanceSettings(){const {mode,setMode,storageError}=useAppearance();return <><Select aria-label="应用外观" value={mode} onChange={v=>setMode(parseAppearance(v))} optionLabelProp="label" options={Object.entries(labels).map(([value,label])=>({value,label}))}/>{storageError&&<p role="status">已切换外观，但浏览器未允许保存偏好；刷新后可能恢复默认。</p>}</>;}
