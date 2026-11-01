import {theme as antdTheme,type ThemeConfig} from 'antd';
import {XProvider} from '@ant-design/x';
import zhCN from 'antd/locale/zh_CN';
import {useMemo,type ComponentProps,type ReactNode} from 'react';
import {useAppearance} from '../appearanceContext';

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
  colorPrimary: '#2563eb',
  colorInfo: '#2563eb',
  colorSuccess: '#2f7d54',
  colorWarning: '#a4691f',
  colorError: '#b3403c',
  colorBgBase: '#f5f7fb',
  colorBgLayout: '#f5f7fb',
  colorBgContainer: '#ffffff',
  colorBgElevated: '#ffffff',
  colorBgSpotlight: '#25324a',
  colorBorder: '#d8deea',
  colorBorderSecondary: '#e8ecf3',
  colorText: '#182338',
  colorTextSecondary: '#66738a',
  colorTextTertiary: '#8995a8',
  colorFillSecondary: 'rgba(37,99,235,0.06)',
  colorFillTertiary: 'rgba(37,99,235,0.04)',
  boxShadowSecondary: '0 18px 44px rgba(18,42,44,0.14)',
};

const dark: ThemeConfig['token'] = {
  colorPrimary: '#80aaff',
  colorInfo: '#80aaff',
  colorSuccess: '#5fc79a',
  colorWarning: '#e0b25f',
  colorError: '#f08268',
  colorBgBase: '#111827',
  colorBgLayout: '#101725',
  colorBgContainer: '#192235',
  colorBgElevated: '#202c42',
  colorBgSpotlight: '#2b3a53',
  colorBorder: '#41516b',
  colorBorderSecondary: '#303e55',
  colorText: '#edf2fc',
  colorTextSecondary: '#a8b6cc',
  colorTextTertiary: '#8191aa',
  colorFillSecondary: 'rgba(128,170,255,0.10)',
  colorFillTertiary: 'rgba(128,170,255,0.06)',
  boxShadowSecondary: '0 18px 44px rgba(0,0,0,0.38)',
};

function components(isDark:boolean):ThemeConfig['components']{
  return {
    Button:{defaultShadow:'none',primaryShadow:'none',fontWeight:500,borderRadius:10},
    Input:{borderRadius:7,activeShadow:isDark?'0 0 0 2px rgba(128,170,255,0.12)':'0 0 0 2px rgba(37,99,235,0.08)',paddingInline:12,hoverBorderColor:isDark?'#53647f':'#c8d2e2'},
    Select:{borderRadius:7,controlHeight:34},
    InputNumber:{borderRadius:7,controlHeight:34},
    Card:{borderRadiusLG:16,paddingLG:16,headerHeight:38},
    Modal:{borderRadiusLG:16},
    Tag:{borderRadiusSM:999,defaultBg:isDark?'#253149':'#eef1f7',defaultColor:isDark?'#edf2fc':'#182338'},
    Tooltip:{fontSize:12,colorBgSpotlight:isDark?'#2b3a53':'#25324a'},
    Segmented:{itemSelectedBg:isDark?'#2b3a53':'#ffffff',trackBg:isDark?'#141d2d':'#eef1f7'},
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
  return <XProvider locale={zhCN} theme={config as unknown as XThemeProp} button={{autoInsertSpace:false}}>{children}</XProvider>;
}
