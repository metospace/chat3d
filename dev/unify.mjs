// Counts Radix vs antd nodes on each surface of the running app.
// Usage: node dev/unify.mjs [baseURL]
import {chromium} from 'playwright-core';
import {browserPath} from '../e2e/config.mjs';

const base=process.argv[2]??'http://localhost:1420';
const browser=await chromium.launch({executablePath:browserPath(),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[];
page.on('pageerror',e=>errors.push(String(e).slice(0,120)));
page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text().slice(0,120));});

const count=async()=>page.evaluate(()=>{
  const q=s=>document.querySelectorAll(s).length;
  return {antd:q('[class*="ant-"]'),radix:q('[class*="rt-"]'),heroui:q('[class*="heroui"]'),
    rtClass:[...new Set([...document.querySelectorAll('[class*="rt-"]')].flatMap(e=>[...e.classList].filter(c=>c.startsWith('rt-'))))].slice(0,8),
    overflow:document.documentElement.scrollWidth>window.innerWidth};
});

await page.goto(base,{waitUntil:'networkidle'});
const surfaces=[];
const visit=async(name,click)=>{try{await click();await page.waitForTimeout(700);surfaces.push({name,...await count()});}catch(e){surfaces.push({name,error:String(e).slice(0,80)});}};
surfaces.push({name:'home',...await count()});
await visit('assets',()=>page.getByRole('button',{name:'资产库',exact:true}).click());
await visit('scenes',()=>page.getByRole('button',{name:'场景库',exact:true}).click());
await visit('team',()=>page.getByRole('button',{name:'团队库',exact:true}).click());
await visit('settings',()=>page.getByRole('button',{name:'设置',exact:true}).click());
await visit('home-again',()=>page.getByRole('button',{name:'首页',exact:true}).click());
console.table(surfaces);
console.log('errors:',errors.length?errors:'none');
await browser.close();
