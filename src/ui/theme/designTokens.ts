import type {ThemeConfig} from 'antd';

// Shared semantic palette for Ant Design, Ant Design X, and application CSS.
export const shared: NonNullable<ThemeConfig['token']> = {
  fontFamily: '"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif',
  fontSize: 14,
  borderRadius: 6,
  borderRadiusLG: 8,
  borderRadiusSM: 4,
  controlHeight: 32,
  controlHeightSM: 24,
  lineWidth: 1,
  motionDurationMid: '0.16s',
  wireframe: false,
};

export const light: NonNullable<ThemeConfig['token']> = {
  colorPrimary: '#1677ff',
  colorInfo: '#1677ff',
  colorSuccess: '#2f7d54',
  colorWarning: '#a4691f',
  colorError: '#b3403c',
  colorBgBase: '#f5f5f5',
  colorBgLayout: '#f5f5f5',
  colorBgContainer: '#ffffff',
  colorBgElevated: '#ffffff',
  colorBgSpotlight: '#25324a',
  colorBorder: '#d9d9d9',
  colorBorderSecondary: '#f0f0f0',
  colorText: '#202733',
  colorTextSecondary: '#697586',
  colorTextTertiary: '#929baa',
  colorFillSecondary: 'rgba(31,41,55,0.05)',
  colorFillTertiary: 'rgba(31,41,55,0.025)',
  boxShadowSecondary: '0 8px 28px rgba(24,39,64,0.10), 0 2px 6px rgba(24,39,64,0.04)',
};

export const dark: NonNullable<ThemeConfig['token']> = {
  colorPrimary: '#80aaff',
  colorTextLightSolid: '#102349',
  colorInfo: '#80aaff',
  colorSuccess: '#5fc79a',
  colorWarning: '#e0b25f',
  colorError: '#f08268',
  colorBgBase: '#141414',
  colorBgLayout: '#141414',
  colorBgContainer: '#1f1f1f',
  colorBgElevated: '#262626',
  colorBgSpotlight: '#2b3a53',
  colorBorder: '#424242',
  colorBorderSecondary: '#303030',
  colorText: '#edf0f5',
  colorTextSecondary: '#a8b3c2',
  colorTextTertiary: '#7f8ca0',
  colorFillSecondary: 'rgba(128,170,255,0.10)',
  colorFillTertiary: 'rgba(128,170,255,0.06)',
  boxShadowSecondary: '0 18px 44px rgba(0,0,0,0.38)',
};


export function applyDesignTokens(mode:'light'|'dark') {
 const palette=mode==='dark'?dark:light;
 const aliases:Record<string, string|number|undefined>={
  'surface-page':palette.colorBgLayout,'surface-elevated':palette.colorBgContainer,
  'surface-muted':mode==='dark'?'#262626':'#f0f2f5','surface-subtle':mode==='dark'?'#1f1f1f':'#fafafa',
  border:palette.colorBorder,'border-subtle':palette.colorBorderSecondary,
  ink:palette.colorText,'ink-muted':palette.colorTextSecondary,
  accent:palette.colorPrimary,'accent-soft':mode==='dark'?'#15395b':'#e6f4ff',
  'accent-ink':mode==='dark'?'#102349':'#ffffff',focus:palette.colorPrimary,
  nav:palette.colorBgContainer,'nav-ink':palette.colorText,'nav-muted':palette.colorTextSecondary,
  'nav-active':mode==='dark'?'#15395b':'#e6f4ff',
  'control-hover':mode==='dark'?'#61728a':'#aeb8c6',
  'focus-ring':mode==='dark'?'rgba(128,170,255,0.14)':'rgba(49,101,223,0.10)',
  'shadow-panel':mode==='dark'?'0 4px 16px #00000024':'0 3px 12px #1827400a','shadow-float':palette.boxShadowSecondary,
 };
 for(const [key,value] of Object.entries(aliases)) if(value!==undefined) document.documentElement.style.setProperty(`--sc-${key}`,String(value));
}
