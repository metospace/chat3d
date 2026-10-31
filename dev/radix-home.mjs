// Lists the remaining Radix nodes on the home surface.
import {chromium} from 'playwright-core';
import {browserPath} from '../e2e/config.mjs';
const base=process.argv[2]??'http://localhost:1420';
const browser=await chromium.launch({executablePath:browserPath(),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}});
await page.goto(base,{waitUntil:'networkidle'});
await page.waitForTimeout(1200);
const nodes=await page.evaluate(()=>[...document.querySelectorAll('[class*="rt-"]')].map(e=>({tag:e.tagName,cls:e.className,text:(e.textContent||'').trim().slice(0,40)})));
console.log(JSON.stringify(nodes,null,1));
await browser.close();
