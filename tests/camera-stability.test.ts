import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {renderCameraClip} from '../src/pipeline/camera';
import type {Shot} from '../src/lib/types';

// A feature exactly at the zoom's attention point must stay fixed. Test decoded
// pixels over consecutive frames; individual still frames cannot reveal jitter.
test('slow product zoom keeps its focal point stable at subpixel precision',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'camera-stability-'));
  try {
    const width=1080,height=1208,pixels=Buffer.alloc(width*height,16);
    for(let y=589;y<619;y++)for(let x=525;x<555;x++)pixels[y*width+x]=240;
    const source=path.join(dir,'target.pgm'),clip=path.join(dir,'motion.mp4');
    await writeFile(source,Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`),pixels]));
    const shot:Shot={id:'test',sceneId:'test',url:'https://example.test',actions:[],caption:'',start:0,duration:4,type:'media_fullscreen',cameraMode:'media',mediaMotion:{kind:'attention',holdIn:1.5,motionDuration:1.7,holdOut:.8,maxZoom:1.04,focus:{x:.4,y:.4,width:.2,height:.2},reason:'Inspect the central feature without moving its attention point.'}};
    await renderCameraClip(source,clip,shot);
    const {stdout}=await promisify(execFile)('ffmpeg',['-v','error','-i',clip,'-vf','crop=120:120:480:652,format=gray','-frames:v','120','-f','rawvideo','pipe:1'],{encoding:'buffer',maxBuffer:4*1024*1024});
    const centers:{x:number;y:number;weight:number}[]=[];
    for(let offset=0;offset<stdout.length;offset+=120*120){let weight=0,x=0,y=0;
      for(let i=0;i<120*120;i++){const v=Math.max(0,stdout[offset+i]-80);weight+=v;x+=(i%120)*v;y+=Math.floor(i/120)*v;}
      assert.ok(weight>10000,'Focal feature remains visible');centers.push({x:x/weight,y:y/weight,weight});
    }
    assert.equal(centers.length,120);
    for(const axis of ['x','y'] as const){const values=centers.map(c=>c[axis]),spread=Math.max(...values)-Math.min(...values);console.log(`${axis} focal spread: ${spread.toFixed(3)}px`);assert.ok(spread<.15,`${axis} focal point shakes by ${spread.toFixed(3)}px during a slow zoom`);}
    for(const [start,end] of [[0,44],[100,119]])assert.ok(Math.abs(centers[start].weight-centers[end].weight)/centers[start].weight<.01,'Opening and settled ending do not continue scaling (allowing codec noise)');
  } finally {await rm(dir,{recursive:true,force:true});}
});
