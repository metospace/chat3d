// Screenshot the Ant Design X chat design lab. Usage: node dev/shot.mjs [baseURL]
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {browserPath} from '../e2e/config.mjs';

const base=process.argv[2]??'http://localhost:1420';
const out='dev/shots';
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:browserPath(),headless:true});
const shots=[['dark','empty'],['dark','conversation'],['dark','previewing'],['dark','busy'],['light','conversation']];
for(const [appearance,state] of shots){
  const page=await browser.newPage({viewport:{width:560,height:920},deviceScaleFactor:2});
  await page.goto(`${base}/dev/chat-preview.html?state=${state}`);
  await page.evaluate(value=>localStorage.setItem('chat3d.appearance.v1',value),appearance);
  await page.reload();
  await page.waitForTimeout(1400);
  const file=`${out}/${appearance}-${state}.png`;
  await page.screenshot({path:file});
  console.log('shot',file);
  await page.close();
}
await browser.close();
