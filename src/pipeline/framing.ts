import type { CameraMode, Shot } from '../lib/types';
import { verticalSafeArea, contains, Rect } from './safe-area';
import { videoLayout } from './video-layout';

export interface SourceSize { width:number; height:number; }
export const maximumDetailZoom = 1.12;
export function cameraMode(shot:Shot):CameraMode {
  return shot.cameraMode || (['walkthrough','establish','scroll_to','click_demo'].includes(shot.type||'') ? 'walkthrough' : 'media');
}
// Fit the original source, then optionally inspect it. The fit scale is never a
// cover scale: a normal shot exposes 100% of its source, including landscape UI.
export function cameraGeometry(shot:Shot, source:SourceSize=videoLayout.viewport, progress=1) {
  const mode=cameraMode(shot),width=1080,height=1920;
  const area=mode==='walkthrough'?{x:0,y:0,width,height}:{x:0,y:108,width,height:1208};
  const fit=Math.min(area.width/source.width,area.height/source.height);
  const sx=source.width*fit/width,sy=source.height*fit/height;
  const left=(1-sx)/2,top=(area.y+(area.height-source.height*fit)/2)/height;
  const region=mode==='detail'?shot.camera?.focus||shot.focus||shot.highlight:undefined;
  const justified=mode==='detail' && !!shot.camera?.reason && !!shot.camera.detailText && !!region;
  const desired=justified?Math.min(maximumDetailZoom,Math.max(1,shot.camera?.maxZoom??1.08)):1;
  const motion=shot.camera?.motion||shot.motion||'hold';
  const t=motion==='hold'?1:Math.max(0,Math.min(1,progress));
  const zoom=motion==='slow-pull'?desired+(1-desired)*t:1+(desired-1)*t;
  const clamp=(n:number,max:number)=>Math.max(-max,Math.min(max,n));
  // A small, directed reframe can move edge controls left of platform buttons.
  // It shifts the source over spare canvas rather than increasing cover zoom.
  const r=region;
  const x=justified && r?clamp(left+r.x*sx<24/1080/zoom?left+r.x*sx-24/1080/zoom:Math.max(0,left+(r.x+r.width)*sx-862/1080/zoom),.3)*t:0;
  const y=justified && r?clamp(top+r.y*sy<108/1920/zoom?top+r.y*sy-108/1920/zoom:Math.max(0,top+(r.y+r.height)*sy-1316/1920/zoom),.3)*t:0;
  const visibleWidth=Math.max(0,Math.min(left+sx,x+1/zoom)-Math.max(left,x));
  const visibleHeight=Math.max(0,Math.min(top+sy,y+1/zoom)-Math.max(top,y));
  return {mode,sx,sy,left,top,fit,base:1,zoom,x,y,region,visibleSourceArea:Math.min(1,visibleWidth*visibleHeight/(sx*sy))};
}
export function projectedFocus(shot:Shot,source:SourceSize,progress=1):Rect|undefined {
  const g=cameraGeometry(shot,source,progress),r=g.region;
  if(!r)return;
  return {x:(g.left+r.x*g.sx-g.x)*g.zoom*1080,y:(g.top+r.y*g.sy-g.y)*g.zoom*1920,width:r.width*g.sx*g.zoom*1080,height:r.height*g.sy*g.zoom*1920};
}
export function focalIsSafe(shot:Shot,source:SourceSize) {
  const r=projectedFocus(shot,source);
  return !r || contains(verticalSafeArea.focal,r);
}
