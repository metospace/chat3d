import {useMemo,type ComponentProps,type ReactNode} from 'react';
import {theme as antdTheme,type ThemeConfig} from 'antd';
import zhCN from 'antd/locale/zh_CN';
import {XProvider} from '@ant-design/x';
import {useAppearance} from '../Appearance';

type XTheme = NonNullable<ComponentProps<typeof XProvider>['theme']>;

/** Light palette keeps the frosted studio surfaces; accents reuse the teal used across the app. */
const light: ThemeConfig['token'] = {
  colorPrimary: '#0f6b69',
  colorInfo: '#0f6b69',
  colorSuccess: '#2a8a63',
  colorWarning: '#b4761c',
  colorError: '#c2402f',
  colorBgBase: '#f2f6f6',
  colorBgLayout: '#eaf1f1',
  colorBgContainer: '#fdfefe',
  colorBgElevated: '#ffffff',
  colorBgSpotlight: '#213537',
  colorBorder: '#d3e1e1',
  colorBorderSecondary: '#e3eded',
  colorText: '#1b2e2f',
  colorTextSecondary: '#4d6667',
  colorTextTertiary: '#6b8384',
  colorFillSecondary: 'rgba(15,107,105,0.06)',
  colorFillTertiary: 'rgba(15,107,105,0.04)',
  boxShadowSecondary: '0 18px 44px rgba(18,42,44,0.14)',
};

/** Dark palette mirrors the graphite canvas: deep teal panels, soft mint accent. */
const dark: ThemeConfig['token'] = {
  colorPrimary: '#6cc9bd',
  colorInfo: '#6cc9bd',
  colorSuccess: '#5fc79a',
  colorWarning: '#e0b25f',
  colorError: '#f08268',
  colorBgBase: '#101d1e',
  colorBgLayout: '#0d191a',
  colorBgContainer: '#1a2c2e',
  colorBgElevated: '#213739',
  colorBgSpotlight: '#2c4749',
  colorBorder: '#33504f',
  colorBorderSecondary: '#294343',
  colorText: '#e8f3f2',
  colorTextSecondary: '#a9c2c2',
  colorTextTertiary: '#8aa4a4',
  colorFillSecondary: 'rgba(108,201,189,0.10)',
  colorFillTertiary: 'rgba(108,201,189,0.06)',
  boxShadowSecondary: '0 18px 44px rgba(0,0,0,0.38)',
};

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

/**
 * Ant Design X reads its component tokens from the design token provider it wraps around antd's
 * ConfigProvider, so one theme object drives both the antd widgets and the X widgets.
 */
export function AdxChatTheme({children}:{children:ReactNode}){
  const {resolved}=useAppearance();
  const isDark=resolved==='dark';
  const config=useMemo<ThemeConfig>(()=>({
    algorithm: isDark?antdTheme.darkAlgorithm:antdTheme.defaultAlgorithm,
    token: {...shared,...(isDark?dark:light)},
    components:{
      Button:{defaultShadow:'none',primaryShadow:'none',fontWeight:500,borderRadius:10,controlHeight:32},
      Input:{activeShadow:'0 0 0 2px rgba(15,107,105,0.16)',paddingInline:12},
      Card:{borderRadiusLG:16,paddingLG:16,headerHeight:38},
      Segmented:{itemSelectedBg:isDark?'#2c4749':'#ffffff',trackBg:isDark?'#16292b':'#e6efef'},
      Tag:{borderRadiusSM:999},
      Tooltip:{fontSize:12,colorBgSpotlight:isDark?'#2c4749':'#213537'},
      Checkbox:{borderRadiusSM:4},
      Dropdown:{borderRadiusLG:14},
    },
  }),[isDark]);
  return <XProvider locale={zhCN} theme={config as unknown as XTheme}>{children}</XProvider>;
}
