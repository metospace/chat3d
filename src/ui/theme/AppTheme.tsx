import {theme as antdTheme,type ThemeConfig} from 'antd';
import {XProvider} from '@ant-design/x';
import {shared,light,dark} from './designTokens';
import zhCN from 'antd/locale/zh_CN';
import {useMemo,type ComponentProps,type ReactNode} from 'react';
import {useAppearance} from '../appearanceContext';

type XThemeProp = NonNullable<ComponentProps<typeof XProvider>['theme']>;

/**
 * The single theme for the whole app: antd widgets and Ant Design X widgets read the
 * same tokens from designTokens.ts, which also populates CSS variables so light / dark
 * switching keeps one visual identity everywhere.
 */
function components(isDark:boolean):ThemeConfig['components']{
  const palette=isDark?dark:light;
  return {
    Button:{defaultShadow:'none',primaryShadow:'none',fontWeight:500,borderRadius:6},
    Input:{borderRadius:6,activeShadow:'0 0 0 2px color-mix(in srgb, var(--sc-accent) 12%, transparent)',paddingInline:12,hoverBorderColor:palette.colorPrimary},
    Select:{borderRadius:6,controlHeight:36},
    InputNumber:{borderRadius:6,controlHeight:36},
    Card:{borderRadiusLG:10,paddingLG:16,headerHeight:38},
    Modal:{borderRadiusLG:12},
    Tag:{borderRadiusSM:999,defaultBg:palette.colorFillSecondary,defaultColor:palette.colorText},
    Tooltip:{fontSize:12,colorBgSpotlight:palette.colorBgSpotlight},
    Segmented:{itemSelectedBg:palette.colorBgContainer,trackBg:palette.colorFillSecondary},
    Dropdown:{borderRadiusLG:10,paddingBlock:5},
    Checkbox:{borderRadiusSM:4},
  };
}

export function AppTheme({children}:{children:ReactNode}){
  const {resolved}=useAppearance();
  const isDark=resolved==='dark';
  const config=useMemo<ThemeConfig>(()=>({
    algorithm: isDark?antdTheme.darkAlgorithm:antdTheme.defaultAlgorithm,
    token: {...shared,...(isDark?dark:light)},
    components: components(isDark),
  }),[isDark]);
  return <XProvider locale={zhCN} theme={config as unknown as XThemeProp} button={{autoInsertSpace:false}}>{children}</XProvider>;
}
