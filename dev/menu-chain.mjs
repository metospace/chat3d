import {chromium} from 'playwright-core';
import {browserPath} from '../e2e/config.mjs';
const base=process.argv[2]??'http://localhost:1420';
const browser=await chromium.launch({executablePath:browserPath(),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}});
await page.goto(base,{waitUntil:'networkidle'});
await page.getByRole('button',{name:'新建空白项目'}).click();
await page.waitForTimeout(2500);
await page.getByRole('button',{name:'切换视角'}).click();
await page.waitForTimeout(500);
const chain=await page.locator('.studio-control-menu').evaluate(el=>{
  const out=[];let cur=el;
  while(cur&&out.length<5){out.push({tag:cur.tagName,cls:cur.className,padding:getComputedStyle(cur).padding});cur=cur.parentElement;}
  return out;
});
console.log(JSON.stringify(chain,null,1));
await browser.close();
