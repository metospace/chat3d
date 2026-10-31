// Measures the migrated library page: tiles keep their card skin, search keeps its box.
import {chromium} from 'playwright-core';
import {browserPath} from '../e2e/config.mjs';
const base=process.argv[2]??'http://localhost:1420';
const browser=await chromium.launch({executablePath:browserPath(),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[];page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,140));});
const out={};
await page.goto(base,{waitUntil:'networkidle'});
await page.waitForTimeout(600);
await page.getByRole('button',{name:'资产库',exact:true}).click();
await page.waitForTimeout(900);
out.emptyState=await page.locator('.resource-empty, .studio-empty-state').count();
if(!await page.locator('.resource-tile').count()){
  const create=page.getByRole('button',{name:/新建资产|创建资产/}).first();
  if(await create.count()){ await create.click(); await page.waitForTimeout(1500); }
}
const tile=page.locator('.resource-tile').first();
out.tileCount=await page.locator('.resource-tile').count();
if(out.tileCount){
  out.tileBox=await tile.boundingBox();
  out.tileStyle=await tile.evaluate(el=>{const s=getComputedStyle(el);return {bg:s.backgroundColor,radius:s.borderRadius,border:s.borderTopWidth+' '+s.borderTopColor,display:s.display,padding:s.padding};});
}
out.searchWrapper=await page.locator('.resource-search .ant-input-affix-wrapper').evaluate(el=>{const s=getComputedStyle(el);return {bg:s.backgroundColor,border:s.borderTopWidth+' '+s.borderTopColor,h:Math.round(el.getBoundingClientRect().height)};}).catch(()=>null);
out.segmentStyle=await page.locator('.resource-segments button').first().evaluate(el=>{const s=getComputedStyle(el);return {bg:s.backgroundColor,radius:s.borderRadius,h:Math.round(el.getBoundingClientRect().height)};}).catch(()=>null);
out.sortBox=await page.locator('.resource-sort select').boundingBox().catch(()=>null);
out.radix=await page.evaluate(()=>[...document.querySelectorAll('[class*="rt-BaseButton"]')].map(e=>(e.className||'').split(' ').slice(-2).join(' ')).slice(0,6));
out.overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
out.errors=errors.slice(0,3);
console.log(JSON.stringify(out,null,1));
await browser.close();
