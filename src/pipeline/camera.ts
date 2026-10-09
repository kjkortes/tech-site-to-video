import { Shot, VisualAsset } from '../lib/types';
import { run, probe } from '../lib/process';
import { videoLayout } from './video-layout';
import { sourceCodeFilter } from './source-code';
import { cameraGeometry, SourceSize } from './framing';

export const cameraRenderRevision = 2;

export function cameraFilter(shot: Shot, source:SourceSize=videoLayout.viewport) {
  const g=cameraGeometry(shot,source,1);
  const filters:string[]=[];
  if(shot.highlight && g.mode==='detail') {const h=shot.highlight;filters.push(`drawbox=x=iw*${h.x}:y=ih*${h.y}:w=iw*${h.width}:h=ih*${h.height}:color=0x60a5fa@0.95:t=4`);}
  const areaHeight=g.mode==='walkthrough'?1920:1208;
  const top=g.mode==='walkthrough'?'(oh-ih)/2':`108+(${areaHeight}-ih)/2`;
  filters.push(`scale=1080:${areaHeight}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1080:1920:(ow-iw)/2:${top}:color=0x0c1b35`, 'fps=30');
  if(g.mode==='detail' && g.zoom>1) {
    const duration=shot.camera?.duration||shot.duration,offset=shot.camera?.offset||0;
    const p=`min(1,max(0,(on/30+${offset})/${duration}))`,eased=`(${p}*${p}*(3-2*${p}))`;
    const zoom=shot.camera?.motion==='slow-pull'?`${g.zoom}+(1-${g.zoom})*${eased}`:`1+(${g.zoom}-1)*${eased}`;
    // Extra canvas permits a gentle lateral reframe without forcing cover crop.
    filters.push('pad=2160:3840:(ow-iw)/2:(oh-ih)/2:color=0x0c1b35');
    filters.push(`zoompan=z='2*(${zoom})':x='iw/4+iw/2*${g.x}*${eased}':y='ih/4+ih/2*${g.y}*${eased}':d=1:s=1080x1920:fps=30`);
  }
  if(shot.mediaMotion && g.mode==='media') {
    const m=shot.mediaMotion;
    const p=`min(1,max(0,((on-1)/30-${m.holdIn})/${m.motionDuration}))`,eased=`(${p}*${p}*(3-2*${p}))`;
    const zoom=`1+(${m.maxZoom}-1)*${eased}`;
    // Start full-width. A small approach uses the spare canvas, with a calm settle.
    // Optional inventory focus directs the center; never infer UI coordinates from text.
    const cx=m.focus?g.left+(m.focus.x+m.focus.width/2)*g.sx:.5;
    const cy=m.focus?g.top+(m.focus.y+m.focus.height/2)*g.sy:.5;
    // zoompan truncates crop size/position to integer pixels, creating visible
    // jumps during these slow moves. An affine perspective transform samples
    // fractional source coordinates instead. 4:4:4 avoids chroma-grid snapping;
    // convert to delivery 4:2:0 only after the continuous transform.
    const x=`W*${cx}*(1-1/(${zoom}))`,y=`H*${cy}*(1-1/(${zoom}))`;
    filters.push('format=yuv444p');
    filters.push(`perspective=x0='${x}':y0='${y}':x1='${x}+W/(${zoom})':y1='${y}':x2='${x}':y2='${y}+H/(${zoom})':x3='${x}+W/(${zoom})':y3='${y}+H/(${zoom})':sense=source:eval=frame:interpolation=cubic`);
  }
  filters.push('setsar=1','format=yuv420p');
  return filters.join(',');
}
export async function renderCameraClip(source:string,destination:string,shot:Shot,animated=false,sourceStart=0,sourceAsset?:VisualAsset,_legacyOrigin?:string) {
  const size=await probe(source);const stream=size.streams.find(s=>s.codec_type==='video');
  if(!stream?.width||!stream.height)throw new Error('Camera source has no usable dimensions');
  const filter=shot.type==='code_focus' && sourceAsset?sourceCodeFilter(shot,sourceAsset):cameraFilter(shot,{width:stream.width,height:stream.height});
  // Exactly one input visual. Legacy contextPreview is never composited here.
  const args=['-y',...(animated?['-stream_loop','-1']:['-loop','1','-framerate','30']),...(sourceStart>0?['-ss',String(sourceStart)]:[]),'-i',source,'-vf',filter];
  await run('ffmpeg',[...args,'-t',String(shot.duration+.15),'-an','-c:v','libx264','-threads','2','-preset','veryfast','-crf','20','-pix_fmt','yuv420p',destination]);
}
