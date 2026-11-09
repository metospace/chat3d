/**
 * Design lab for the Ant Design X chat surface.
 * Open /dev/chat-preview.html?state=empty|conversation|previewing|busy and edit the seed below when
 * iterating on the skin without booting the whole editor.
 */
import {createRoot} from 'react-dom/client';
import '@radix-ui/themes/styles.css';
import '../src/index.css';
import {AppearanceProvider} from '../src/ui/Appearance';
import {ChatPanel} from '../src/ui/ChatPanel';
import {createInitialDoc,useEditorStore,type ChatMessage} from '../src/store';
import type {AgentActivity} from '../src/ai/modelingAgent';

const params=new URLSearchParams(location.search);
const state=params.get('state')??'conversation';
const now=Date.now();

const activity:AgentActivity={
  title:'生成一个工作台',turn:1,toolCalls:2,characters:640,inputTokens:12408,outputTokens:2140,usageReported:true,lastEventAt:now,
  plan:[],events:[],
  explanations:[
    {id:'e1',text:'先确认台面尺寸与结构，再按 40mm 板厚生成板材与四根腿。'},
    {id:'e2',text:'零件倒角按 2mm 处理，避免与地面接触时穿模。'},
  ],
  timings:[
    {id:'t1',kind:'model',label:'读取场景上下文',startedAt:now-18000,endedAt:now-15000},
    {id:'t2',kind:'tool',label:'生成台面板与隔板',startedAt:now-15000,endedAt:now-9000},
    {id:'t3',kind:'tool',label:'生成腿柱并校验承重',startedAt:now-9000,endedAt:now-4000},
  ],
};
if(state==='busy'){
 activity.phase='building';activity.lastModelEditAt=now-16000;
 activity.explanations=[{id:'understanding',createdAt:now-30000,phase:'planning',text:'参考图是叉车式 AGV。我会先还原窄车身、双立柱门架和前伸货叉；图片未给出实测尺寸，整体尺度按图估算。'},{id:'building',createdAt:now-15000,phase:'building',text:'主体轮廓已建立。现在补齐门架的层次与货叉连接，再从正面和侧面核对比例。'}];
 activity.timings=[{id:'plan',kind:'tool',toolName:'plan_object_structure',label:'规划对象结构',phase:'planning',startedAt:now-26000,endedAt:now-24000},{id:'build',kind:'tool',toolName:'build_modeling_program',label:'参数化构建',phase:'building',startedAt:now-23000,endedAt:now-16000},{id:'waiting',kind:'model',label:'model',phase:'building',startedAt:now-14000,firstContentAt:now-10000,pendingToolName:'patch_modeling_program'}];
}

const userMessage:ChatMessage={id:'m1',role:'user',text:'做一个长 1.2 米、宽 0.8 米、高 0.75 米的工作台，台面 40mm 厚，两层隔板，带四根腿。',createdAt:now-24000};
const assistantMessage:ChatMessage={
  id:'m2',role:'assistant',createdAt:now-4000,outcome:'applied',
  text:'工作台已生成：台面 1200×800×40mm，两层隔板间距 280mm，四根 60×60mm 腿柱。\n仍需改进：腿柱与台面的连接件尚未建模，可在后续指令中补充。',
  run:{mode:'pi',startedAt:now-18000,endedAt:now-4000,status:'completed',activity},
};
const steeringMessage:ChatMessage={id:'m3',role:'user',text:'把台面改成胡桃木色，隔板再加一层',createdAt:now-1200,steering:{runId:'r1',status:'queued'}};
const queuedMessage:ChatMessage={id:'m4',role:'user',text:'再给台面加一个 60mm 的后挡边',createdAt:now-600,queuedTask:{status:'waiting'}};

const conversation:ChatMessage[]=[userMessage,assistantMessage,steeringMessage,queuedMessage];
const busyConversation:ChatMessage[]=[{...userMessage,text:'生成 AGV 模型',run:{mode:'pi',startedAt:now-30000,status:'running',activity}}];

const messages=state==='empty'?[]:state==='busy'?busyConversation:conversation;
const doc=createInitialDoc();
useEditorStore.setState({
  viewportStatus:'ready',
  doc,
  messages,
  aiStatus:state==='previewing'?'previewing':state==='busy'?'generating':'idle',
  aiConfig:{baseURL:'https://api.example.com/v1',apiKey:'preview-key',model:'scenivo-modeling',useMock:false,agentMode:'pi'},
  selection:[],
  pendingBatch:state==='previewing'?{requestId:'preview-1',projectId:doc.projectId,baseRevision:doc.revision,selectedIds:[],summary:'已生成工作台主体\n仍需改进：腿柱连接件待补充',operations:[]}:null,
  pendingResult:null,
  previewDoc:null,
  aiError:null,
});

function Preview(){
  return <AppearanceProvider>
    <div className="preview-frame"><ChatPanel canvasMode expanded onConfigure={()=>{}} onAssets={()=>{}}/></div>
  </AppearanceProvider>;
}

createRoot(document.getElementById('root')!).render(<Preview/>);
