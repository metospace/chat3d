import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {installBrowserGlobals} from './jsdom-env.mjs';
const css=readFileSync('src/ui/theme/product.css','utf8');
const dom=new JSDOM(`<style>${css}</style><div class="canvas-studio frosted-studio manager-mode"><div class="home-project-link"><img></div><div class="resource-tile"><img></div><div class="resource-layout-grid"><div class="resource-tile"><img><div class="resource-no-thumb"></div></div></div><div class="resource-project-grid"><div class="resource-row"><img></div></div><div class="home-featured-open"><img></div><div class="home-featured-choices"><button><img></button></div><div class="resource-detail"><img></div><div class="resource-layout-list"><div class="resource-tile"><img></div></div><div class="canvas-asset-item"><img></div></div>`);installBrowserGlobals(dom);
try {
 const style=e=>dom.window.getComputedStyle(e);
 for(const selector of ['.home-project-link img','.resource-tile img','.resource-project-grid img','.home-featured-open img','.home-featured-choices img','.resource-detail img']){
  const s=style(dom.window.document.querySelector(selector));assert.equal(s.objectFit,'cover',selector);assert.equal(s.aspectRatio,'4 / 3',selector);assert.equal(s.padding,'0px',selector);assert.equal(s.height,'auto',selector);
 }
 console.log('PASS home drafts featured and details preserve borderless 4:3 cover frames');
 for(const preview of dom.window.document.querySelectorAll('.resource-layout-grid .resource-tile > *')){const s=style(preview);assert.equal(s.aspectRatio,'1 / 1');assert.equal(s.objectFit,'contain');assert.equal(s.height,'auto');}
 console.log('PASS library grid previews are square and preserve the full model or placeholder');
 const choice=style(dom.window.document.querySelector('.home-featured-choices button'));assert.equal(choice.padding,'0px');assert.equal(choice.overflow,'hidden');
 console.log('PASS featured choices do not inset thumbnails within a padded white frame');
 const list=style(dom.window.document.querySelector('.resource-layout-list img'));assert.equal(list.width,'112px');assert.equal(list.height,'84px');assert.equal(list.objectFit,'cover');assert.equal(style(dom.window.document.querySelector('.canvas-asset-item img')).objectFit,'cover');
 console.log('PASS compact list and asset shelf fill their thumbnail regions');
 const app=readFileSync('src/App.tsx','utf8');assert.ok(app.includes("import './ui/theme/product.css'"));assert.ok(!app.includes("import './creative-gallery.css'"));
 console.log('PASS thumbnails use the consolidated product stylesheet');
} finally {dom.window.close();}
