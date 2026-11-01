import type {ThemeConfig} from 'antd';

// Shared semantic palette for Ant Design, Ant Design X, and application CSS.
export const shared: NonNullable<ThemeConfig['token']> = {
  fontFamily: '"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif',
  fontSize: 14,
  borderRadius: 6,
  borderRadiusLG: 10,
  borderRadiusSM: 4,
  controlHeight: 36,
  controlHeightSM: 32,
  lineWidth: 1,
  motionDurationMid: '0.16s',
  wireframe: false,
};

export const light: NonNullable<ThemeConfig['token']> = {
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

export const dark: NonNullable<ThemeConfig['token']> = {
  colorPrimary: '#80aaff',
  colorTextLightSolid: '#102349',
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


export function applyDesignTokens(mode:'light'|'dark') {
 const palette=mode==='dark'?dark:light;
 const aliases:Record<string, string|number|undefined>={
  'surface-page':palette.colorBgLayout,'surface-elevated':palette.colorBgContainer,
  'surface-muted':mode==='dark'?'#253149':'#eef1f7','surface-subtle':mode==='dark'?'#202c42':'#fafbfe',
  border:palette.colorBorder,'border-subtle':palette.colorBorderSecondary,
  ink:palette.colorText,'ink-muted':palette.colorTextSecondary,
  accent:palette.colorPrimary,'accent-soft':mode==='dark'?'#223b64':'#eaf1ff',
  'accent-ink':mode==='dark'?'#102349':'#ffffff',focus:palette.colorPrimary,
  nav:palette.colorBgContainer,'nav-ink':palette.colorText,'nav-muted':palette.colorTextSecondary,
  'nav-active':mode==='dark'?'#223b64':'#eaf1ff',
  'shadow-panel':'0 1px 2px #00000004','shadow-float':palette.boxShadowSecondary,
 };
 for(const [key,value] of Object.entries(aliases)) if(value!==undefined) document.documentElement.style.setProperty(`--sc-${key}`,String(value));
}
