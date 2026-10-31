// Structural + geometry check for the Ant Design X chat surface (no screenshots needed).
// Usage: node dev/check.mjs [baseURL]
import {chromium} from 'playwright-core';
import {browserPath} from '../e2e/config.mjs';

const base=process.argv[2]??'http://localhost:1420';
const browser=await chromium.launch({executablePath:browserPath(),headless:true});
let problems=0;
const report=(ok,label,detail)=>{if(!ok)problems++;console.log(`${ok?'ok  ':'FAIL'} ${label}${detail?` — ${detail}`:''}`)};

for(const state of ['empty','conversation','previewing','busy']){
  const page=await browser.newPage({viewport:{width:560,height:920},deviceScaleFactor:1});
  const errors=[];
  page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text())});
  page.on('pageerror',error=>errors.push(String(error)));
  page.on('response',response=>{if(response.status()>=400)errors.push(`${response.status()} ${response.url()}`)});
  await page.goto(`${base}/dev/chat-preview.html?state=${state}`);
  await page.evaluate(()=>localStorage.setItem('chat3d.appearance.v1','dark'));
  await page.reload();
  await page.waitForSelector('.adx-chat');
  await page.waitForTimeout(900);
  console.log(`\n[${state}]`);
  report(errors.length===0,'no console/page errors',errors.slice(0,4).join(' | '));

  const metrics=await page.evaluate(()=>{
    const el=sel=>document.querySelector(sel);
    const box=sel=>{const node=el(sel);if(!node)return null;const r=node.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height)}};
    const chat=el('.adx-chat');
    const sender=el('.ant-sender');
    const overflows=[...document.querySelectorAll('.adx-chat *')].filter(node=>node.scrollWidth>node.clientWidth+1&&getComputedStyle(node).overflowX!=='auto'&&getComputedStyle(node).overflowX!=='scroll'&&!node.closest('.chat-transcript')).slice(0,3).map(node=>`${node.className||node.tagName}:${node.scrollWidth}>${node.clientWidth}`);
    return {
      chat:box('.adx-chat'),sender:box('.ant-sender'),
      senderRadius:sender?getComputedStyle(sender).borderRadius:null,
      senderBorder:sender?getComputedStyle(sender).borderTopWidth:null,
      bubbles:document.querySelectorAll('.ant-bubble').length,
      thoughtChain:document.querySelectorAll('.ant-thought-chain').length,
      welcome:document.querySelectorAll('.ant-welcome').length,
      starters:document.querySelectorAll('.adx-starter').length,
      preview:document.querySelectorAll('.adx-preview').length,
      queueRows:document.querySelectorAll('.adx-queue-row').length,
      sendLabels:[...document.querySelectorAll('.adx-send-cluster button')].map(node=>node.getAttribute('aria-label')),
      transcriptScroll:{scroll:el('.chat-transcript')?.scrollHeight??0,client:el('.chat-transcript')?.clientHeight??0},
      font:getComputedStyle(document.body).fontFamily,
      overflows,
    };
  });
  report(metrics.chat?.h>700,'panel fills the frame',`h=${metrics.chat?.h}`);
  report(metrics.sender?.h>60,'composer dock has height',`h=${metrics.sender?.h}`);
  report(metrics.senderRadius!=='0px','composer uses the rounded X skin',`radius=${metrics.senderRadius}`);
  report(metrics.overflows.length===0,'no horizontal overflow',metrics.overflows.join(', '));
  report(metrics.bubbles>0||state==='empty','transcript renders bubbles',`count=${metrics.bubbles}`);
  if(state==='empty')report(metrics.welcome===1&&metrics.starters>=2,'welcome + starters',`welcome=${metrics.welcome} starters=${metrics.starters}`);
  if(state==='conversation'){await page.click('.adx-run-toggle');await page.waitForTimeout(300);const chain=await page.evaluate(()=>document.querySelectorAll('.ant-thought-chain').length);report(chain>=1&&metrics.queueRows===1,'thought chain + queue row',`chain=${chain} queue=${metrics.queueRows}`);}
  if(state==='previewing')report(metrics.preview===1,'preview card',`count=${metrics.preview}`);
  if(state==='busy')report(metrics.sendLabels.includes('停止生成'),'stop affordance while running',metrics.sendLabels.join('/'));
  if(state!=='busy')report(metrics.sendLabels.includes('发送'),'send affordance when idle',metrics.sendLabels.join('/'));
  await page.close();
}
await browser.close();
console.log(`\n${problems===0?'ALL GOOD':`${problems} problem(s)`}`);
process.exit(problems===0?0:1);
