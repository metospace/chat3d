import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React from 'react';
import {setTimeout as delay} from 'node:timers/promises';
import {createServer} from 'vite';
import {installBrowserGlobals} from './jsdom-env.mjs';
const dom=new JSDOM('<html><body></body></html>');installBrowserGlobals(dom);for(const k of ['window','document','HTMLElement','Node','MutationObserver','Event','MouseEvent'])Object.defineProperty(globalThis,k,{value:dom.window[k],configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {render,fireEvent,cleanup,act}=await import('@testing-library/react');const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {SaveToast}=await server.ssrLoadModule('/src/ui/SaveToast.tsx');let closed=0;const close=()=>closed++;
 const ui=render(React.createElement(SaveToast,{message:'saved',onClose:close,duration:30,verbatim:true}));
 await act(async()=>delay(60));assert.equal(closed,1);
 ui.rerender(React.createElement(SaveToast,{message:'import failed',onClose:close,duration:0,tone:'error',verbatim:true}));
 assert.equal(ui.getByRole('alert').textContent.includes('import failed'),true);await act(async()=>delay(60));assert.equal(closed,1);
 fireEvent.click(ui.getByRole('button'));assert.equal(closed,2);
 ui.rerender(React.createElement(SaveToast,{message:'new result',onClose:close,duration:30,verbatim:true}));cleanup();await act(async()=>delay(60));assert.equal(closed,2);
 console.log('PASS transient results expire, errors persist until dismissed, unmount cancels expiry');
}finally{cleanup();await server.close();dom.window.close();}
