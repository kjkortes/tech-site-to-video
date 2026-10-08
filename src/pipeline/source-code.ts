import type { Page } from 'playwright';
import type { Shot, VisualAsset } from '../lib/types';
import { panelFor } from './video-layout';
import { relevance } from './visual-utils';

export function readableCodeRange(asset:VisualAsset,range:{start:number;end:number}) {
  const lines=(asset.text||'').split('\n');
  const executable=(line:string)=>!!line.trim() && !/^\s*(?:#|\/\/|\/\*|\*|<!--)/.test(line);
  const selected=lines.map((text,i)=>({text,number:i+1})).filter(l=>l.number>=range.start && l.number<=range.end && executable(l.text));
  return selected.length?{start:selected[0].number,end:selected.at(-1)!.number}:range;
}
export function codeLines(asset:VisualAsset,narration:string) {
  const lines=(asset.text||'').split('\n');let best=0,score=-1;
  lines.forEach((line,i)=>{const value=relevance(narration,line)+(/\b(mcp|json|cli|install|command)\b/i.test(line)&&/\b(mcp|json|cli|install|command)\b/i.test(narration)?1:0);if(value>score){score=value;best=i;}});
  const start=Math.max(1,best),end=Math.min(lines.length,start+5);
  return readableCodeRange(asset,{start,end});
}
// Capture the original DOM, colors and indentation, including code hidden behind overflow.
export async function captureSourceCode(page:Page,selector:string,destination:string) {
  const block=page.locator(selector).first();
  const original=await block.getAttribute('style');
  try {
    await block.evaluate(el=>{const pre=el as HTMLElement;pre.style.width=`${Math.min(3200,Math.max(pre.clientWidth,pre.scrollWidth))}px`;pre.style.maxWidth='none';pre.style.height=`${Math.min(4000,Math.max(pre.clientHeight,pre.scrollHeight))}px`;pre.style.maxHeight='none';pre.style.overflow='hidden';});
    const measure=()=>{
      const pre=document.querySelector(selector)! as HTMLElement,rect=pre.getBoundingClientRect(),text=pre.textContent||'',code=pre.querySelector('code')||pre;
      const walker=document.createTreeWalker(pre,NodeFilter.SHOW_TEXT),nodes:{node:Node;start:number;end:number}[]=[];let node:Node|null,total=0;
      while((node=walker.nextNode())){const length=node.textContent?.length||0;nodes.push({node,start:total,end:total+length});total+=length;}
      let offset=0;const lines=text.split('\n').map((line,i)=>{
        const a=nodes.find(n=>offset>=n.start && offset<n.end),b=nodes.find(n=>offset+Math.max(0,line.length-1)>=n.start && offset+Math.max(0,line.length-1)<n.end);
        let bounds:DOMRect|undefined;
        if(a && b && line.length){const range=document.createRange();range.setStart(a.node,offset-a.start);range.setEnd(b.node,offset+line.length-b.start);bounds=range.getBoundingClientRect();}
        offset+=line.length+1;
        return {number:i+1,region:{x:Math.max(0,(bounds?.x||rect.x)-rect.x)/rect.width,y:Math.max(0,(bounds?.y||rect.y)-rect.y)/rect.height,width:Math.max(.01,Math.min(rect.width,bounds?.width||1)/rect.width),height:Math.max(.01,Math.min(rect.height,bounds?.height||1)/rect.height)}};
      });
      return {width:rect.width,height:rect.height,fontSize:parseFloat(getComputedStyle(code).fontSize),lines};
    };
    // tsx's helper is included because this function runs in the source browser.
    const metadata=await page.evaluate<ReturnType<typeof measure>>(`(()=>{const __name=(fn)=>fn;const selector=${JSON.stringify(selector)};return (${measure.toString()})();})()`);
    await block.screenshot({path:destination,animations:'disabled',timeout:7000});
    return metadata;
  }finally{await block.evaluate((el,style)=>{if(style===null)el.removeAttribute('style');else el.setAttribute('style',style);},original);}
}
export function sourceCodeFilter(shot:Shot,asset:VisualAsset) {
  const range=readableCodeRange(asset,shot.codeRange||{start:1,end:7});
  const panel=panelFor(shot.framing),sourceLines=(asset.text||'').split('\n'),lines=asset.code?.lines.filter(l=>!!sourceLines[l.number-1]?.trim() && l.number>=range.start && l.number<=range.end);
  const first=lines?.length?Math.min(...lines.map(l=>l.region.y)):.02,last=lines?.length?Math.max(...lines.map(l=>l.region.y+l.region.height)):Math.min(.95,(shot.codeRange?.end||7)/(asset.text||'').split('\n').length);
  const x=lines?.length?Math.min(...lines.map(l=>l.region.x)):.03,right=lines?.length?Math.max(...lines.map(l=>l.region.x+l.region.width)):.97;
  const font=asset.code?.fontSize||28,margin=font*.8,verticalMargin=font*.2;
  const left=Math.max(0,x*asset.width-margin),top=Math.max(0,first*asset.height-verticalMargin);
  const rightPx=Math.min(asset.width,right*asset.width+margin),bottom=Math.min(asset.height,last*asset.height+verticalMargin);
  const width=Math.max(2,Math.floor(Math.min(rightPx-left,font*panel.width/28)/2)*2),height=Math.max(2,Math.floor(Math.min(bottom-top,width*panel.height/panel.width)/2)*2);
  const progress=`min(1,(t+${shot.sourceOffset||0})/${Math.max(.1,(shot.support?shot.support.visualEnd-shot.support.visualStart:shot.duration)-.3)})`,panX=rightPx-left>width+2?`${left}+${rightPx-left-width}*${progress}`:String(left),panY=bottom-top>height+2?`${top}+${bottom-top-height}*${progress}`:String(top);
  const annotation=shot.highlight?`drawbox=x=iw*${shot.highlight.x}:y=ih*${shot.highlight.y}:w=iw*${shot.highlight.width}:h=ih*${shot.highlight.height}:color=0x60a5fa@0.9:t=3,`:'';
  return `${annotation}crop=w=${width}:h=${height}:x='${panX}':y='${panY}',scale=${panel.width}:${panel.height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${panel.width}:${panel.height}:(ow-iw)/2:(oh-ih)/2:color=0x0c1b35,fps=30,setsar=1,format=yuv420p`;
}
