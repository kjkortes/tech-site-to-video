'use client';
import {useEffect,useState} from 'react';
import type {Job,Script} from '@/lib/types';
export function WorkflowSteps({job}:{job:Job}) {
  const current=job.status==='SCRIPT_REVIEW'?2:job.status==='NARRATION_PENDING'||job.status==='TTS'?3:job.status==='AUDIO_REVIEW'?4:['DIRECTING','RECORDING','EDITING','QA'].includes(job.status)?5:['READY_FOR_REVIEW','APPROVED','SKIPPED'].includes(job.status)?6:job.status==='RECEIVED'?(job.narration?.state==='approved'?5:job.narration?.state==='pending'?3:job.completed.includes('EXPLORING')?1:0):1;
  return <ol className="workflow-steps" aria-label="Generation workflow">{['Source','Research / script','Review script','Narration','Review audio','Generate video','Review video'].map((label,i)=><li key={label} aria-current={i===current?'step':undefined} className={i===current?'current':i<current?'done':''}><span>{i+1}</span>{label}</li>)}</ol>;
}
interface Props {job:Job;script:Script|null;busy:boolean;act:(action:string,input?:Record<string,unknown>)=>Promise<void>;upload:(file:File)=>Promise<void>;}
export function ApprovalReview({job,script,busy,act,upload}:Props) {
  const text=script?.text??script?.segments.map(s=>s.text).join('\n\n')??'';
  const [draft,setDraft]=useState(text),[own,setOwn]=useState(false),[feedback,setFeedback]=useState(''),[file,setFile]=useState<File|null>(null);
  useEffect(()=>{setDraft(text);setOwn(script?.review?.source==='user_provided');},[job.id,script?.review?.version]);
  useEffect(()=>{setFile(null);},[job.id,job.narration?.version]);
  const dirty=draft!==text,version=script?.review?.version;
  if(job.status==='SCRIPT_REVIEW')return <section className="approval-review" aria-label="Script review">
    <div className="approval-heading"><div><span className="review-label">Step 3 · Review script</span><h4>Your words, before your voice.</h4></div><span>Version {version} · {script?.review?.source?.replace('_',' ')}</span></div>
    <p>Review or edit the VO script. Narration and video generation are waiting for your approval.</p>
    {job.narration?.state==='stale'&&<p className="review-warning">Existing narration is stale. After approving a changed script, regenerate or replace the audio.</p>}
    <label htmlFor="vo-script">VO script</label><textarea id="vo-script" value={draft} onChange={e=>setDraft(e.target.value)} disabled={busy} rows={12} maxLength={20000}/>
    <div className="approval-buttons"><button className="secondary" disabled={busy||!draft.trim()||!dirty&&!own} onClick={()=>act('save-script',{text:draft,source:own?'user_provided':'edited',scriptVersion:version})}>{own?'Save my script':'Save edits'}</button><button className="text-button" disabled={busy} onClick={()=>{setOwn(true);setDraft('');}}>Use my own script</button><button className="primary" disabled={busy||dirty||!version} onClick={()=>act('approve-script',{scriptVersion:version})}>Approve script</button></div>
    {dirty&&<p className="muted">Save your changes before approving. Your saved version becomes the authoritative script.</p>}
    <details className="regeneration-feedback"><summary>Regenerate script</summary><label htmlFor="script-feedback">Optional direction</label><input id="script-feedback" value={feedback} onChange={e=>setFeedback(e.target.value)} maxLength={2000} placeholder="Make it shorter, strengthen the hook, less technical…" disabled={busy}/><button className="secondary" disabled={busy} onClick={()=>act('regenerate-script',{feedback,scriptVersion:version})}>Regenerate script</button><p className="muted">Uses saved research and exploration.</p></details>
  </section>;
  const narration=job.narration,mismatch=narration?.mismatch?.significant;
  return <section className="approval-review" aria-label={job.status==='AUDIO_REVIEW'?'Audio review':'Narration options'}>
    <div className="approval-heading"><div><span className="review-label">{job.status==='AUDIO_REVIEW'?'Step 5 · Review audio':'Step 4 · Narration'}</span><h4>{job.status==='AUDIO_REVIEW'?'Listen before generating the video.':'Choose your narration.'}</h4></div><span>Script v{version} approved</span></div>
    <p>Final visual planning, capture and rendering have not started.</p>
    {job.status==='AUDIO_REVIEW'?<>
      <div className="audio-summary"><strong>{narration?.source==='uploaded'?'Uploaded Audio':'Generated TTS'}</strong><span>{narration?.duration?.toFixed(1)} seconds · Audio v{narration?.version}</span></div>
      <audio key={`${job.id}-${narration?.version}`} controls preload="metadata" src={`/api/jobs/${job.id}/files/narration.wav?v=${job.revision}-${narration?.version}`} aria-label="Narration preview"/>
      {mismatch&&<div className="review-warning" role="alert"><strong>The uploaded narration differs from the approved script.</strong><p>{narration?.mismatch?.message}</p><details><summary>Recognized narration</summary><p>{narration?.mismatch?.transcript}</p></details><div className="approval-buttons"><button className="secondary" disabled={busy} onClick={()=>act('use-audio-transcript')}>Use audio transcript</button><button className="secondary" disabled={busy} onClick={()=>act('replace-audio')}>Keep script and replace audio</button><button className="secondary" disabled={busy} onClick={()=>act('approve-audio',{scriptVersion:version,audioVersion:narration?.version,mismatchResolution:'proceed'})}>Proceed anyway & generate video</button></div></div>}
      <div className="approval-buttons"><button className="primary" disabled={busy||mismatch} onClick={()=>act('approve-audio',{scriptVersion:version,audioVersion:narration?.version})}>Approve & generate video</button>{narration?.source==='generated'&&<button className="secondary" disabled={busy} onClick={()=>act('generate-tts')}>Regenerate TTS</button>}<button className="secondary" disabled={busy} onClick={()=>act('replace-audio')}>Replace audio</button><button className="text-button" disabled={busy} onClick={()=>act('back-script')}>Back to script</button></div>
    </>:<>
      <div className="narration-options"><div><h5>Generate TTS</h5><p>Use the configured voice and narration service.</p><button className="primary" disabled={busy} onClick={()=>act('generate-tts')}>Generate TTS</button></div><div><h5>Upload narration audio</h5><p>Use your own voice or externally generated TTS. WAV, MP3 or M4A, up to 100 MB.</p><label htmlFor="narration-file">Narration file</label><input id="narration-file" type="file" accept=".wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4" disabled={busy} onChange={e=>setFile(e.target.files?.[0]||null)}/><button className="secondary" disabled={busy||!file} onClick={()=>file&&upload(file)}>Upload & align narration</button></div></div><button className="text-button" disabled={busy} onClick={()=>act('back-script')}>Back to script</button>
    </>}
    <details open className="approved-script"><summary>Approved script · version {version}</summary><div>{text}</div></details>
  </section>;
}
