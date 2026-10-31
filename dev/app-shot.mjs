// Screenshot the chat surface inside the real app shell with a seeded transcript.
// Usage: node dev/app-shot.mjs [baseURL]
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {browserPath} from '../e2e/config.mjs';

const base=process.argv[2]??'http://localhost:1420';
const out='dev/shots';
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:browserPath(),headless:true});

for(const appearance of ['dark','light']){
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  page.on('pageerror',error=>console.log('pageerror',String(error).slice(0,200)));
  await page.addInitScript(value=>localStorage.setItem('chat3d.appearance.v1',value),appearance);
  await page.goto(base);
  await page.getByRole('button',{name:'新建空白项目'}).click();
  await page.getByLabel('建模指令').waitFor({timeout:20000});
  await page.evaluate(async()=>{
    const {activeConversationStore}=await import('/src/conversationStores.ts');
    const store=activeConversationStore();
    const now=Date.now();
    const activity={
      title:'生成一个工作台',turn:1,toolCalls:2,characters:640,inputTokens:12408,outputTokens:2140,usageReported:true,lastEventAt:now,
      plan:[],events:[],
      explanations:[{id:'e1',text:'先确认台面尺寸与结构，再按 40mm 板厚生成板材与四根腿。'},{id:'e2',text:'零件倒角按 2mm 处理，避免与地面接触时穿模。'}],
      timings:[
        {id:'t1',kind:'model',label:'读取场景上下文',startedAt:now-18000,endedAt:now-15000},
        {id:'t2',kind:'tool',label:'生成台面板与隔板',startedAt:now-15000,endedAt:now-9000},
        {id:'t3',kind:'tool',label:'生成腿柱并校验承重',startedAt:now-9000,endedAt:now-4000},
      ],
    };
    store.setState({
      aiConfig:{baseURL:'https://api.example.com/v1',apiKey:'seeded',model:'scenivo-modeling',useMock:false,agentMode:'pi',generationQuality:'fine'},
      aiStatus:'idle',aiError:null,pendingBatch:null,pendingResult:null,previewDoc:null,
      messages:[
        {id:'m1',role:'user',text:'做一个长 1.2 米、宽 0.8 米、高 0.75 米的工作台，台面 40mm 厚，两层隔板，带四根腿。',createdAt:now-24000},
        {id:'m2',role:'assistant',createdAt:now-4000,outcome:'applied',text:'工作台已生成：台面 1200×800×40mm，两层隔板间距 280mm，四根 60×60mm 腿柱。\n仍需改进：腿柱与台面的连接件尚未建模，可在后续指令中补充。',run:{mode:'pi',generationQuality:'fine',startedAt:now-18000,endedAt:now-4000,status:'completed',activity}},
        {id:'m3',role:'user',text:'把台面改成胡桃木色，隔板再加一层',createdAt:now-1200,steering:{runId:'r1',status:'queued'}},
        {id:'m4',role:'user',text:'再给台面加一个 60mm 的后挡边',createdAt:now-600,queuedTask:{status:'waiting'}},
      ],
    });
  });
  await page.waitForTimeout(900);
  const metrics=await page.evaluate(()=>{
    const chat=document.querySelector('.adx-chat');
    const sender=document.querySelector('.adx-sender');
    const region=document.querySelector('.conversation-region');
    const rect=node=>node?{w:Math.round(node.getBoundingClientRect().width),h:Math.round(node.getBoundingClientRect().height)}:null;
    const overflows=[...document.querySelectorAll('.adx-chat *')].filter(node=>node.scrollWidth>node.clientWidth+1&&['visible','clip'].includes(getComputedStyle(node).overflowX)&&!node.closest('.chat-transcript')).slice(0,4).map(node=>`${node.className||node.tagName}:${node.scrollWidth}>${node.clientWidth}`);
    return {chat:rect(chat),sender:rect(sender),region:rect(region),bubbles:document.querySelectorAll('.ant-bubble').length,overflows};
  });
  console.log(appearance,'metrics',JSON.stringify(metrics));
  const file=`${out}/app-${appearance}-conversation.png`;
  await page.screenshot({path:file});
  console.log('shot',file);
  await page.close();
}
await browser.close();
