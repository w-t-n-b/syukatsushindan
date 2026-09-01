// 最小のCDPクライアント: ヘッドレスChromeを起動し、実ページ上でJSを評価する
import { spawn } from 'node:child_process';
import fsx from 'node:fs';
import { requireChrome, EXTRA_FLAGS } from './chrome-path.mjs';
const CHROME = requireChrome('cdp');

async function withPage(url, width, height, fn){
  const port = 9222 + Math.floor(Math.random()*900);
  const tmp = '/tmp/cdpprof' + port;
  const p = spawn(CHROME, [
    '--headless=new','--disable-gpu','--hide-scrollbars','--no-first-run','--no-default-browser-check',
    '--user-data-dir='+tmp, '--remote-debugging-port='+port,
    '--window-size='+width+','+height, ...EXTRA_FLAGS, 'about:blank'
  ], { stdio:'ignore' });
  const base = 'http://127.0.0.1:'+port;
  let list=null;
  for(let i=0;i<120;i++){
    try{ const r=await fetch(base+'/json/list'); list=await r.json(); if(list.length) break; }catch(e){}
    await new Promise(r=>setTimeout(r,100));
  }
  if(!list||!list.length){ p.kill(); throw new Error('chrome not ready'); }
  const target = list.find(t=>t.type==='page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  let id=0; const waiting=new Map();
  ws.onmessage = ev => { const m=JSON.parse(ev.data); if(m.id&&waiting.has(m.id)){waiting.get(m.id)(m);waiting.delete(m.id);} };
  const send=(method,params={})=>new Promise(res=>{const i=++id;waiting.set(i,res);ws.send(JSON.stringify({id:i,method,params}));});
  await send('Page.enable');
  await send('Runtime.enable');
  // ★ macOS のヘッドレスChromeは --window-size を最小約500pxにクランプする。
  //    実機幅を再現するには必ず Emulation で上書きすること。
  await send('Emulation.setDeviceMetricsOverride',
    {width:width,height:height,deviceScaleFactor:2,mobile:true});
  await send('Page.navigate',{url});
  await new Promise(r=>setTimeout(r,3500));
  const evalJS = async expr => {
    const r = await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
    if(r.result&&r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result&&r.result.result&&r.result.result.value;
  };
  const screenshot = async path => {
    const r = await send('Page.captureScreenshot',{format:'png'});
    fsx.writeFileSync(path, Buffer.from(r.result.data,'base64'));
  };
  try{ await fn({evalJS, screenshot}); } finally { ws.close(); p.kill(); }
}
export { withPage };
