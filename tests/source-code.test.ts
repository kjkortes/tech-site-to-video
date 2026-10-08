import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { launchBrowser } from '../src/pipeline/browser';
import { captureSourceCode } from '../src/pipeline/source-code';
import { recordShots } from '../src/pipeline/record';
import { config } from '../src/lib/config';
import { jobDir } from '../src/lib/store';
import { probe } from '../src/lib/process';
import type { Inventory,Shot } from '../src/lib/types';

test('code close-up uses original syntax-highlighted DOM capture, expands overflow, and keeps per-shot retry caching',async()=>{
  const original={...config};config.dataDir=await mkdtemp(path.join(tmpdir(),'source-code-'));const browser=await launchBrowser();
  try {
    const id=randomUUID(),dir=jobDir(id);await mkdir(dir,{recursive:true});const page=await browser.newPage({viewport:{width:600,height:500}});
    await page.setContent('<style>body{background:#0c1b35}pre{width:250px;overflow:auto;padding:20px;background:#101e36;font:22px/1.5 monospace}b{color:#65df9c}</style><h2>Agent control</h2><pre id="commands"><code># MCP agent access\n<b>editor</b> mcp --transport stdio --verbose --read-only\neditor cli --help</code></pre>');
    const metadata=await captureSourceCode(page,'#commands',path.join(dir,'actual.png'));
    assert.ok(metadata.width>250,'Capture includes horizontally hidden source');assert.equal(metadata.lines.length,3);
    assert.equal(await page.locator('#commands').getAttribute('style'),null,'Exploration DOM is restored');
    assert.equal(await page.locator('b').evaluate(el=>getComputedStyle(el).color),'rgb(101, 223, 156)');
    const info=await probe(path.join(dir,'actual.png')),stream=info.streams[0];const url='https://example.test/editor';
    const inventory:Inventory={contentMode:'developer',notes:[],scenes:[{id:'section',url,title:'Agent control',description:'MCP',actions:[],screenshot:'actual.png'}],assets:[{id:'code',sceneId:'section',type:'code',url,pageUrl:url,localPath:'actual.png',text:'# MCP agent access\neditor mcp --transport stdio --verbose --read-only\neditor cli --help',description:'Original MCP command',features:['MCP'],width:stream.width!,height:stream.height!,code:{fontSize:metadata.fontSize,lines:metadata.lines},quality:.9,confidence:.9,canEnlarge:true,animated:false}]};
    const shot:Shot={id:'001',sceneId:'section',assetId:'code',type:'code_focus',codeRange:{start:1,end:2},start:0,duration:1,url,actions:[],caption:'',captionPosition:'bottom-center',framing:'detail',contextPreview:'actual.png'};
    const results=await recordShots(id,[shot],inventory,async()=>{});assert.equal(results[0].kind,'asset');assert.equal(results[0].fallback,false);
    const output=await probe(path.join(dir,results[0].clip));assert.equal(output.streams[0].width,1080);
    let captures=0;await recordShots(id,[shot],inventory,async()=>{captures++;});assert.equal(captures,0,'Successful actual code close-up is cached');
  }finally{await browser.close();await rm(config.dataDir,{recursive:true,force:true});Object.assign(config,original);}
});
