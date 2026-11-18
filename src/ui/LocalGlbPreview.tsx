import { useEffect, useRef, useState } from 'react';
import { Button, Select, Spin, Tag } from 'antd';
import { Cross1Icon, EyeOpenIcon } from '@radix-ui/react-icons';
import { PortalDialog } from './kit/PortalDialog';
import { useAppearance } from './appearanceContext';
import { assertGlbSize } from '../scene/glbLimit';
import { mountLocalGlbPreview, type LocalGlbView } from '../scene/localGlbPreview';
import './local-glb-preview.css';

type ViewState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; clips: string[] };
const backgrounds = { light: '#eef1f7', dark: '#20232e' };

function PreviewDialog({ file, chooseFile, close }: { file: File; chooseFile: () => void; close: () => void }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const preview = useRef<LocalGlbView | null>(null);
  const [state, setState] = useState<ViewState>({ status: 'loading' });
  const [clip, setClip] = useState(0);
  const [playing, setPlaying] = useState(false);
  const { resolved } = useAppearance();
  const background = backgrounds[resolved];
  const currentBackground = useRef(background);
  currentBackground.current = background;

  useEffect(() => {
    if (!host) return;
    let alive = true;
    async function open(container: HTMLDivElement) {
      try {
        if (!/\.glb$/i.test(file.name)) throw Error('请选择扩展名为 .glb 的文件。');
        assertGlbSize(file.size);
        const view = mountLocalGlbPreview(container, currentBackground.current, () => {
          if (alive) setState({ status: 'error', message: '三维画布已失去连接，请重新选择文件。' });
        });
        preview.current = view;
        const clips = await view.load(file);
        if (!alive) return;
        if (clips.length) view.selectClip(0);
        setState({ status: 'ready', clips });
      } catch (error) {
        if (!alive) return;
        preview.current?.dispose();
        preview.current = null;
        setState({ status: 'error', message: error instanceof Error ? error.message : '无法读取这个 GLB。' });
      }
    }
    void open(host);
    return () => {
      alive = false;
      preview.current?.dispose();
      preview.current = null;
    };
  }, [file, host]);
  useEffect(() => { preview.current?.setBackground(background); }, [background]);

  return <PortalDialog label="预览本地 GLB" onClose={close} width={1080} className="local-glb-preview">
    <header className="local-glb-header">
      <div><h2 title={file.name}>{file.name}</h2><p>只读预览 · 不创建项目，不上传文件</p></div>
      <Tag>本地 GLB</Tag>
      <Button type="text" icon={<Cross1Icon/>} aria-label="关闭本地预览" onClick={close}/>
    </header>
    <div className="local-glb-stage">
      <div ref={setHost} className="local-glb-canvas"/>
      {state.status === 'loading' && <div className="local-glb-message" role="status"><Spin size="small"/>正在读取并解析 GLB…</div>}
      {state.status === 'error' && <div className="local-glb-message" role="alert"><strong>无法预览此文件</strong><span>{state.message}</span></div>}
    </div>
    <footer className="local-glb-footer">
      <Button onClick={chooseFile}>选择其他 GLB</Button>
      <Button disabled={state.status !== 'ready'} onClick={() => preview.current?.fit()}>适应视图</Button>
      {state.status === 'ready' && state.clips.length > 0 && <>
        <Select aria-label="动画片段" value={clip} options={state.clips.map((name, value) => ({ label: name, value }))}
          onChange={value => { setClip(value); preview.current?.selectClip(value); }}/>
        <Button onClick={() => { preview.current?.setPlaying(!playing); setPlaying(!playing); }}>{playing ? '暂停动画' : '播放动画'}</Button>
      </>}
      <span>拖动旋转 · 右键平移 · 滚轮缩放</span>
    </footer>
  </PortalDialog>;
}

export function LocalGlbPreview() {
  const input = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<{ file: File; selection: number }>();
  return <>
    <Button type="text" className="local-glb-trigger" icon={<EyeOpenIcon/>} onClick={() => input.current?.click()}>预览本地 GLB</Button>
    <input ref={input} type="file" accept=".glb,model/gltf-binary" aria-label="选择本地 GLB 预览文件" hidden onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (file) setSelected(previous => ({ file, selection: (previous?.selection ?? 0) + 1 }));
    }}/>
    {selected && <PreviewDialog key={selected.selection} file={selected.file} chooseFile={() => input.current?.click()} close={() => setSelected(undefined)}/>}
  </>;
}
