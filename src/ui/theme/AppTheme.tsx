import {theme as antdTheme,type ThemeConfig} from 'antd';
import {XProvider} from '@ant-design/x';
import zhCN from 'antd/locale/zh_CN';
import {useMemo,type ComponentProps,type ReactNode} from 'react';
import {useAppearance} from '../Appearance';

type XThemeProp = NonNullable<ComponentProps<typeof XProvider>['theme']>;

/**
 * The single theme for the whole app: antd widgets and Ant Design X widgets read the
 * same tokens, and the palette mirrors `src/ui/studio/tokens.css` so light / dark
 * switching keeps one visual identity everywhere.
 */
const shared: ThemeConfig['token'] = {
  fontFamily: '"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif',
  fontSize: 13,
  borderRadius: 12,
  borderRadiusLG: 14,
  borderRadiusSM: 8,
  controlHeight: 34,
  controlHeightSM: 28,
  lineWidth: 1,
  motionDurationMid: '0.16s',
  wireframe: false,
};

const light: ThemeConfig['token'] = {
  colorPrimary: '#176c6b',
  colorInfo: '#176c6b',
  colorSuccess: '#2f7d54',
  colorWarning: '#a4691f',
  colorError: '#b3403c',
  colorBgBase: '#f3f6f6',
  colorBgLayout: '#eaf1f1',
  colorBgContainer: '#fdfefe',
  colorBgElevated: '#ffffff',
  colorBgSpotlight: '#213537',
  colorBorder: '#c8d5d5',
  colorBorderSecondary: '#dce4e4',
  colorText: '#203334',
  colorTextSecondary: '#526869',
  colorTextTertiary: '#6d8485',
  colorFillSecondary: 'rgba(23,108,107,0.06)',
  colorFillTertiary: 'rgba(23,108,107,0.04)',
  boxShadowSecondary: '0 18px 44px rgba(18,42,44,0.14)',
};

const dark: ThemeConfig['token'] = {
  colorPrimary: '#8bd2c8',
  colorInfo: '#8bd2c8',
  colorSuccess: '#5fc79a',
  colorWarning: '#e0b25f',
  colorError: '#f08268',
  colorBgBase: '#152325',
  colorBgLayout: '#101d1e',
  colorBgContainer: '#1e3032',
  colorBgElevated: '#243739',
  colorBgSpotlight: '#2c4749',
  colorBorder: '#496163',
  colorBorderSecondary: '#354d4f',
  colorText: '#e9f3f2',
  colorTextSecondary: '#b0c5c5',
  colorTextTertiary: '#93a9a9',
  colorFillSecondary: 'rgba(139,210,200,0.10)',
  colorFillTertiary: 'rgba(139,210,200,0.06)',
  boxShadowSecondary: '0 18px 44px rgba(0,0,0,0.38)',
};

function components(isDark:boolean):ThemeConfig['components']{
  return {
    Button:{defaultShadow:'none',primaryShadow:'none',fontWeight:500,borderRadius:10},
    Input:{activeShadow:'0 0 0 2px rgba(23,108,107,0.16)',paddingInline:12},
    Card:{borderRadiusLG:16,paddingLG:16,headerHeight:38},
    Modal:{borderRadiusLG:16},
    Tag:{borderRadiusSM:999,defaultBg:isDark?'#2a4042':'#eaf0f0',defaultColor:isDark?'#e9f3f2':'#203334'},
    Tooltip:{fontSize:12,colorBgSpotlight:isDark?'#2c4749':'#213537'},
    Segmented:{itemSelectedBg:isDark?'#2c4749':'#ffffff',trackBg:isDark?'#16292b':'#e6efef'},
    Dropdown:{borderRadiusLG:14,paddingBlock:5},
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
  return <XProvider locale={zhCN} theme={config as unknown as XThemeProp}>{children}</XProvider>;
}
