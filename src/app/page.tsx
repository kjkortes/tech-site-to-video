'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { ArrowUpRight, Check, CheckCircle2, ChevronDown, ChevronRight, Circle, Clapperboard, Clock3, Download, ExternalLink, Film, Github, Link2, LoaderCircle, MonitorPlay, MoreHorizontal, Play, Plus, RotateCcw, Settings2, ShieldCheck, Sparkles, Volume2, X } from 'lucide-react';
import { Job, Research, Inventory, Script, Transcript, QAReport, Shot, DiversityReport, ContinuityReport, StoryOutline, stages, stageLabels } from '@/lib/types';
import { ModelOptions, StudioModelSettings } from '@/lib/model-options';
import { ModelControls } from './model-controls';

type Detail = { continuity?: ContinuityReport | null; outline?: StoryOutline | null; job: Job; research: Research | null; inventory: Inventory | null; script: Script | null; transcript: Transcript | null; qa: QAReport | null; shots?: Shot[] | null; director?: (DiversityReport & { notes: string[] }) | null; diversity?: DiversityReport | null; };
type Health = { worker: boolean; tts: boolean; ttsState: string; model: string; modelReady: boolean; modelDetail: string; renderer: string; };
const terminal = ['READY_FOR_REVIEW', 'APPROVED', 'SKIPPED', 'FAILED'];
const formatTime = (seconds = 0) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
const statusText = (status: Job['status']) => ({ READY_FOR_REVIEW: 'Ready for review', APPROVED: 'Approved', SKIPPED: 'Skipped', FAILED: 'Needs attention', RECEIVED: 'Queued' }[status as string] || 'Generating');
const fileUrl = (job: Job, file: string) => `/api/jobs/${job.id}/files/${file}?v=${job.revision}`;

export default function Studio() {
  const [jobs, setJobs] = useState<Job[]>([]); const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null); const [health, setHealth] = useState<Health | null>(null);
  const [url, setUrl] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all'); const [tab, setTab] = useState('overview');
  const [regenOpen, setRegenOpen] = useState(false); const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState(''); const [time, setTime] = useState(0); const [loaded, setLoaded] = useState(false);
  const [modelSettings, setModelSettings] = useState<StudioModelSettings | null>(null);
  const [newOptions, setNewOptions] = useState<ModelOptions | null>(null);
  const [defaultsDraft, setDefaultsDraft] = useState<ModelOptions | null>(null);
  const [jobOptions, setJobOptions] = useState<ModelOptions | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false); const [settingsError, setSettingsError] = useState('');
  const input = useRef<HTMLInputElement>(null); const job = detail?.job;
  const studioReady = !!health?.worker && !!health?.tts && health?.modelReady !== false;
  const newModel = newOptions || modelSettings?.defaults;
  const selectedModel = jobOptions || (job?.llm ? { model: job.llm.model, effort: job.llm.effort, creativity: job.llm.creativity } : modelSettings?.defaults);
  const modelName = (options?: ModelOptions) => options?.model ? modelSettings?.models.find(m => m.id === options.model)?.name || options.model : 'Codex default';
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/jobs'); const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setJobs(body.jobs); setLoaded(true);
      if (selected) {
        const response = await fetch(`/api/jobs/${selected}`); const data = await response.json();
        if (response.ok) setDetail(data); else throw new Error(data.error);
      }
    } catch (error) { setError((error as Error).message || 'Cannot reach the local studio.'); }
  }, [selected]);
  useEffect(() => { void refresh(); const timer = setInterval(() => { void refresh(); }, 2500); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => {
    const check = () => { void fetch('/api/health').then(r => r.json()).then(setHealth).catch(() => setHealth(null)); };
    check(); const timer = setInterval(check, 10000); return () => clearInterval(timer);
  }, []);
  useEffect(() => { if (!selected && jobs.length) setSelected(jobs[0].id); }, [jobs, selected]);
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/settings').then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error); if (!cancelled) setModelSettings(data); }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { setJobOptions(null); }, [job?.id, job?.revision]);
  useEffect(() => { setTab('overview'); setTime(0); setRegenOpen(false); }, [selected]);
  useEffect(() => { if (notice) { const timer = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timer); } }, [notice]);
  async function generate(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, llm: newOptions || undefined }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setSelected(data.job.id); setDetail({ job: data.job, research: null, inventory: null, script: null, transcript: null, qa: null }); setUrl(''); await refresh();
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  async function act(action: string, scope = 'full') {
    if (!job) return; setBusy(true); setError(''); setRegenOpen(false);
    try {
      const response = await fetch(`/api/jobs/${job.id}/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, scope, llm: ['regenerate', 'resume'].includes(action) ? jobOptions || undefined : undefined }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setDetail(d => d ? { ...d, job: data.job } : null);
      setNotice(action === 'approve' ? 'Video approved. Your MP4 is ready to download.' : action === 'skip' ? 'Video skipped.' : action === 'resume' ? 'Resuming from saved progress.' : 'Regeneration queued. Completed upstream work is saved.'); await refresh();
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  async function saveDefaults(reset = false) {
    if (!modelSettings || !defaultsDraft && !reset) return;
    setSettingsBusy(true); setSettingsError('');
    try {
      const response = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ defaults: reset ? null : defaultsDraft }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setModelSettings(data); setDefaultsDraft(null);
      setNotice(reset ? 'Environment defaults restored for new videos.' : 'Model defaults saved for new videos.');
    } catch (error) { setSettingsError((error as Error).message); } finally { setSettingsBusy(false); }
  }
  const readyCount = jobs.filter(j => j.status === 'READY_FOR_REVIEW').length;
  const filtered = jobs.filter(j => filter === 'all' || (filter === 'review' ? j.status === 'READY_FOR_REVIEW' : j.status === 'APPROVED'));
  const playable = !!job && ['READY_FOR_REVIEW', 'APPROVED', 'SKIPPED'].includes(job.status);
  const active = !!job && !terminal.includes(job.status);

  return <div className="studio">
    <aside className="sidebar">
      <a className="logo" href="/" aria-label="Frameforge home"><span className="logo-mark"><Film size={21} strokeWidth={2.2}/></span>frameforge<span className="logo-dot">.</span></a>
      <button className="new-project" onClick={() => { input.current?.focus(); }}><Plus size={17}/> New video</button>
      <nav aria-label="Project filters">
        <button className={filter === 'all' ? 'nav-item active' : 'nav-item'} onClick={() => setFilter('all')}><Clapperboard size={18}/> All videos <span>{jobs.length}</span></button>
        <button className={filter === 'review' ? 'nav-item active' : 'nav-item'} onClick={() => setFilter('review')}><MonitorPlay size={18}/> To review <span className={readyCount ? 'count-blue' : ''}>{readyCount}</span></button>
        <button className={filter === 'approved' ? 'nav-item active' : 'nav-item'} onClick={() => setFilter('approved')}><CheckCircle2 size={18}/> Approved <span>{jobs.filter(j => j.status === 'APPROVED').length}</span></button>
      </nav>
      <div className="sidebar-note"><div className="tiny-film"><Play size={15} fill="currentColor"/></div><strong>A URL. A story. A video.</strong><p>Research, narration, recording, and editing. Already handled.</p><span>Made for your next discovery.</span></div>
      <button className="settings-link" onClick={() => { setDefaultsDraft(null); setSettingsError(''); setSettingsOpen(true); }}><Settings2 size={17}/> Studio settings</button>
      <div className="local-profile"><div className="avatar">L</div><div><strong>Local workspace</strong><span>Your files stay on this machine</span></div><span className="online-dot"/></div>
    </aside>
    <main>
      <header className="topbar"><span>Workspace <ChevronRight size={14}/> Video studio</span><div><span className={`service-dot ${studioReady ? 'ok' : ''}`}/>{studioReady ? 'Studio ready' : 'Setup needed'}<button className="icon-button" aria-label="Show studio settings" onClick={() => { setDefaultsDraft(null); setSettingsError(''); setSettingsOpen(true); }}><Settings2 size={18}/></button></div></header>
      <div className="workspace">
        <section className="intro"><div><h1>Your next video starts with a link.</h1><p>Turn a website or GitHub project into a story worth watching.</p></div><span className="format-pill"><Film size={15}/> Shorts & reels</span></section>
        <section className="create-panel" aria-label="Create a video">
          <form onSubmit={generate}><div className="url-field"><Link2 size={19}/><input ref={input} type="url" required maxLength={2048} value={url} onChange={e => setUrl(e.target.value)} placeholder="Paste a website or GitHub URL" aria-label="Website or GitHub URL"/><span className="url-shortcut"><Github size={16}/></span></div><button className="primary generate" disabled={busy}>{busy ? <LoaderCircle size={17} className="spin"/> : <Sparkles size={17}/>} Generate video</button></form>
          <div className="create-meta"><span><MonitorPlay size={14}/> 1080 × 1920</span><span><Clock3 size={14}/> About 60 seconds</span><span><Volume2 size={14}/> Narrated & captioned</span><span className="review-meta"><ShieldCheck size={14}/> You have the final say</span></div>
          {modelSettings && newModel && <details className="model-details"><summary><Settings2 size={14}/> Video model <span>{modelName(newModel)} · {newModel.effort} effort · {newModel.creativity}</span></summary>
            <ModelControls value={newModel} onChange={setNewOptions} models={modelSettings.models} provider={modelSettings.provider} disabled={busy}/>
            <div className="model-actions"><span>{newOptions ? 'Overrides saved defaults for this submission.' : 'Using saved studio defaults.'}</span><button className="text-button" onClick={() => setNewOptions(null)} disabled={!newOptions || busy}>Use studio defaults</button></div>
          </details>}
        </section>
        {health && (!health.worker || !health.tts || !health.modelReady) && <div className="setup-banner"><Circle size={14}/><span>{!health.worker ? 'Start the video worker to process new projects.' : !health.tts ? 'Start your local Kokoro service to generate narration.' : health.modelDetail}</span><button onClick={() => { setDefaultsDraft(null); setSettingsError(''); setSettingsOpen(true); }}>View setup <ArrowUpRight size={13}/></button></div>}
        {error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" onClick={() => setError('')} aria-label="Dismiss error"><X size={16}/></button></div>}
        <div className="section-heading"><div><h2>{filter === 'review' ? 'Ready for your review' : filter === 'approved' ? 'Approved videos' : 'Your videos'}</h2><span>{filtered.length} {filtered.length === 1 ? 'project' : 'projects'}</span></div><span className="autosave"><span/> Progress saved automatically</span></div>
        <section className="editor">
          <div className="project-list">
            <div className="list-title">Projects <button className="icon-button" aria-label="Focus new video URL" onClick={() => input.current?.focus()}><Plus size={16}/></button></div>
            {filtered.map(project => <button key={project.id} className={`project-item ${selected === project.id ? 'selected' : ''}`} onClick={() => setSelected(project.id)}><div className="project-thumb">{['READY_FOR_REVIEW', 'APPROVED', 'SKIPPED'].includes(project.status) ? <img src={fileUrl(project, 'poster.jpg')} alt=""/> : <Film size={21}/>}</div><div><strong>{project.title}</strong><span>{new URL(project.url).hostname.replace('www.', '')}</span><em className={`project-status ${project.status.toLowerCase()}`}>{!terminal.includes(project.status) && <span className="mini-loader"/>}{statusText(project.status)}</em></div><ChevronRight size={14}/></button>)}
            {!filtered.length && <div className="empty-list"><Film size={25}/><strong>{!loaded ? 'Loading your projects…' : filter === 'all' ? 'Your first video goes here' : 'No videos here yet'}</strong><p>{filter === 'all' ? 'Add a public URL above to get started.' : 'Videos will appear here when their review status matches.'}</p></div>}
            <div className="list-footer"><ShieldCheck size={14}/> Human review before every approval</div>
          </div>
          <div className="review-area">
            <div className="review-header"><div><span className="review-label">{playable ? 'Final review' : active ? 'In production' : 'Video preview'}</span><h3>{job?.title || 'A little link goes a long way.'}</h3></div>{job && <a className="icon-button" href={job.url} target="_blank" rel="noreferrer" aria-label="Open source website"><ExternalLink size={17}/></a>}</div>
            <div className="review-body">
              <div className="preview-column"><div className={`phone-frame ${playable ? 'has-video' : ''}`}>
                {playable && job ? <video key={`${job.id}-${job.revision}`} controls preload="metadata" poster={fileUrl(job, 'poster.jpg')} src={fileUrl(job, 'final.mp4')} onTimeUpdate={e => setTime(e.currentTarget.currentTime)} aria-label={`${job.title} generated video`}/> : <div className="preview-empty"><div className="preview-grid"/><div className="preview-art"><div className="mini-browser"><div><i/><i/><i/></div><span/><span/><span/></div><div className="art-play">{active ? <LoaderCircle size={25} className="spin"/> : <Play size={25} fill="currentColor"/>}</div><div className="art-wave">{Array.from({ length: 20 }, (_, i) => <i key={i} style={{ height: `${[8, 16, 24, 12, 30, 19, 9][i % 7]}px` }}/>)}</div></div><strong>{job?.status === 'FAILED' ? 'Saved. Ready to retry.' : active ? 'Your story is taking shape.' : 'Meet your next video.'}</strong><p>{job?.status === 'FAILED' ? 'Fix the setup issue and resume from the last saved stage.' : active ? job.detail : 'The product takes center stage. We handle everything around it.'}</p><span className="preview-format">9:16 · 1080p</span></div>}
              </div><div className="preview-timing"><span>{formatTime(time)}</span><span>{formatTime(job?.duration || 60)}</span></div><div className="timeline-track"><div style={{ width: `${job?.duration ? time / job.duration * 100 : 0}%` }}/></div></div>
              <div className="details-column">
                <div className="detail-tabs" role="tablist" aria-label="Video details">{['overview', 'script', 'shots', 'sources'].map(item => <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? 'current' : ''} onClick={() => setTab(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</div>
                {tab === 'overview' && <div className="detail-content">
                  {!job && <><h4>From discovery to done.</h4><p className="muted">Paste a public link. Come back to a finished demo, with narration, captions, and a clean edit.</p><div className="process-list">{[{ icon: Link2, title: 'Give us the link', text: 'A website, tool, or open-source project.' }, { icon: Clapperboard, title: 'Watch the story come together', text: 'The best visuals, paired with a sourced script.' }, { icon: CheckCircle2, title: 'Review. Approve. Share.', text: 'One final decision. A ready-to-use MP4.' }].map(({ icon: Icon, title, text }, i) => <div key={title}><span className="process-icon"><Icon size={19}/></span><div><strong>{title}</strong><p>{text}</p></div><span className="step-number">{i + 1}</span></div>)}</div><div className="output-note"><Film size={17}/><span>Made for YouTube Shorts, Facebook Reels, and TikTok.</span></div></>}
                  {job && <><div className="video-stats"><div><span>Duration</span><strong>{job.duration ? formatTime(job.duration) : '≈ 01:00'}</strong></div><div><span>QA checks</span><strong>{job.qaScore !== undefined ? `${job.qaScore}%` : 'Pending'}</strong></div><div><span>Format</span><strong>9:16</strong></div></div>
                    {modelSettings && selectedModel && <details className="model-details project-model"><summary><Settings2 size={13}/> {job.llm ? modelName(job.llm) : 'Legacy model settings'}<span>{job.llm?.effort || 'legacy defaults'} · {job.llm?.creativity || 'balanced'}</span></summary>
                      <ModelControls value={selectedModel} onChange={setJobOptions} models={modelSettings.models} provider={job.llm?.provider || modelSettings.provider} disabled={active || busy}/>
                      <p className="model-help">{active ? 'Saved choices are in use for this video.' : 'Changes apply when you resume or regenerate. Saved stages are kept according to the regeneration scope.'}</p>
                      {!active && <button className="text-button" onClick={() => setJobOptions(modelSettings.defaults)} disabled={busy}>Use current studio defaults</button>}
                    </details>}
                    {job.status === 'FAILED' && <div className="failure-detail"><strong>Generation paused</strong><p>{job.error}</p><button className="secondary" disabled={busy} onClick={() => act('resume')}><RotateCcw size={14}/> Resume generation</button></div>}
                    {active && <div className="generation-progress"><div><span>{job.detail}</span><strong>{Math.round(job.progress * 100)}%</strong></div><progress max="1" value={job.progress}/></div>}
                    <div className="stage-list">{stages.map(stage => <div key={stage} className={job.completed.includes(stage) ? 'done' : job.status === stage ? 'working' : ''}>{job.completed.includes(stage) ? <CheckCircle2 size={15}/> : job.status === stage ? <LoaderCircle size={15} className="spin"/> : <Circle size={15}/>}<span>{stageLabels[stage]}</span>{job.completed.includes(stage) && <Check size={12}/>}</div>)}</div>
                    {detail.qa && <div className="qa-results"><h4><ShieldCheck size={16}/> Quality report</h4>{detail.qa.checks.filter(c => !c.passed || ['sources', 'resolution', 'audio'].includes(c.id)).map(c => <div key={c.id}><span className={c.passed ? 'qa-pass' : 'qa-warn'}>{c.passed ? 'Passed' : c.severity === 'warning' ? 'Review' : 'Failed'}</span><p title={c.detail}>{c.label}<small>{c.detail}</small></p></div>)}</div>}
                  </>}
                </div>}
                {tab === 'script' && <div className="detail-content script-content">{detail?.transcript ? detail.transcript.segments.map(segment => <div key={segment.id}><span>{formatTime(segment.start)} – {formatTime(segment.end)}</span><p>{segment.text}</p></div>) : detail?.script ? detail.script.segments.map(segment => <div key={segment.id}><p>{segment.text}</p></div>) : <p className="muted">The narration appears here after the product and its visuals have been researched.</p>}</div>}
                {tab === 'shots' && <div className="detail-content script-content">{detail?.shots?.length ? <><p className="muted">{detail.shots.length} directed shots · continuity {detail.continuity?.score ?? 'pending'}/100 · diversity {detail.diversity?.score ?? detail.director?.score ?? 'pending'}/100</p><a className="secondary" href={fileUrl(job!, 'shot-plan.json')} target="_blank" rel="noreferrer">Open saved shot plan <ExternalLink size={12}/></a>{detail.continuity && <p className="muted">{Math.round(100*detail.continuity.browserDuration/(detail.transcript?.duration||1))}% browser context · <a href={fileUrl(job!, 'walkthrough-state.json')} target="_blank" rel="noreferrer">Walkthrough decisions</a> · <a href={fileUrl(job!, 'page-map.json')} target="_blank" rel="noreferrer">Document map</a> · <a href={fileUrl(job!, 'story-outline.json')} target="_blank" rel="noreferrer">Story outline</a></p>}{detail.shots.map(shot => <div key={shot.id}><span>{formatTime(shot.start)} – {formatTime(shot.start + shot.duration)} · {shot.type} · {shot.framing}</span><p>{shot.purpose}</p>{shot.walkthrough && <small className="muted">{shot.walkthrough.location.heading} · {shot.walkthrough.role}{shot.walkthrough.returnTarget ? ` → return to ${shot.walkthrough.returnTarget.heading}` : ''}</small>}<small className="muted">{shot.rationale} · {shot.motion} · captions {shot.captionPosition}</small></div>)}{detail.director?.notes?.map((note,i)=><p className="muted" key={i}>{note}</p>)}</> : <p className="muted">The selected visuals and shot decisions appear after narration is timed.</p>}</div>}
                {tab === 'sources' && <div className="detail-content sources-content">{detail?.research ? <><p className="muted">Evidence behind the narration. Research mode: {detail.research.mode === 'model' ? 'AI with source citations' : 'exact source excerpts'}.</p>{detail.research.sources.map(source => <a href={source.url} key={source.id} target="_blank" rel="noreferrer"><span>{source.title}</span><small>{new URL(source.url).hostname}</small><ExternalLink size={14}/></a>)}{detail.research.claims.map(claim => <blockquote key={claim.id}>{claim.quote}<cite>{detail.research!.sources.find(s => s.id === claim.sourceId)?.title}</cite></blockquote>)}</> : <p className="muted">Every factual claim in the narration will link back to a source collected during research.</p>}</div>}
              </div>
            </div>
            <div className="review-actions"><span><ShieldCheck size={15}/>{job?.status === 'APPROVED' ? 'Approved. Ready to share.' : playable ? 'Watch the video before you approve.' : 'Your final review happens here.'}</span><div>{job?.status === 'READY_FOR_REVIEW' && <button className="text-button" disabled={busy} onClick={() => act('skip')}>Skip</button>}{job && terminal.includes(job.status) && <div className="regen-wrap"><button className="secondary" onClick={() => setRegenOpen(!regenOpen)} disabled={busy}><RotateCcw size={14}/> Regenerate <ChevronDown size={13}/></button>{regenOpen && <div className="regen-menu">{[['full', 'Full video'], ['script', 'Script & downstream stages'], ['voice', 'Voice & timing'], ['visuals', 'Visuals & edit']].map(([scope, label]) => <button key={scope} onClick={() => act('regenerate', scope)}>{label}</button>)}</div>}</div>}{job?.status === 'READY_FOR_REVIEW' && <button className="primary" disabled={busy} onClick={() => act('approve')}><Check size={16}/> Approve video</button>}{job?.status === 'APPROVED' && <a className="primary" href={`${fileUrl(job, 'final.mp4')}&download`}><Download size={16}/> Download MP4</a>}</div></div>
          </div>
        </section>
        <footer className="workspace-footer"><span>Good software deserves a good story.</span><span>Public links only. No publishing without you.</span></footer>
      </div>
    </main>
    {notice && <div className="toast" role="status"><CheckCircle2 size={18}/>{notice}</div>}
    {settingsOpen && <div className="modal-overlay" onClick={() => setSettingsOpen(false)}><section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={e => e.stopPropagation()}><div><h2 id="settings-title">Studio settings</h2><button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={20}/></button></div><p>Choose defaults for new videos. Override them below the URL form or when regenerating a project. Each video keeps its own model settings.</p><dl><dt>Video worker</dt><dd className={health?.worker ? 'qa-pass' : 'qa-warn'}>{health?.worker ? 'Running' : 'Offline'}</dd><dt>Kokoro narration</dt><dd className={health?.tts ? 'qa-pass' : 'qa-warn'}>{health?.ttsState || 'Checking'}</dd><dt>Research</dt><dd className={health?.modelReady === false ? 'qa-warn' : ''}>{health?.model || 'Checking'}{health?.modelReady === false ? ' · Unavailable' : ''}</dd><dt>Renderer</dt><dd>{health?.renderer || 'Checking'}</dd></dl>{modelSettings ? <div className="settings-model"><h3>Default model & direction</h3><p className="model-help">{modelSettings.provider === 'codex' ? 'Codex · saved ChatGPT login' : modelSettings.provider === 'api' ? 'Configured API provider' : 'Source excerpt mode'}</p><ModelControls value={defaultsDraft || modelSettings.defaults} onChange={setDefaultsDraft} models={modelSettings.models} provider={modelSettings.provider} disabled={settingsBusy}/><p className="model-help">{modelSettings.catalogNote}</p><div className="model-actions"><button className="secondary" disabled={settingsBusy} onClick={() => saveDefaults(true)}>Restore environment defaults</button><button className="primary" disabled={settingsBusy || !defaultsDraft || modelSettings.provider === 'extractive'} onClick={() => saveDefaults()}>{settingsBusy ? <LoaderCircle size={14} className="spin"/> : <Check size={14}/>} Save defaults</button></div>{settingsError && <p className="settings-error" role="alert">{settingsError}</p>}</div> : <p className="model-help">Model settings are loading.</p>}<div className="setup-commands"><strong>Start the studio and worker</strong><code>npm run dev</code><strong>Start Kokoro in its own terminal</strong><code>cd ../kokoro-local-tts<br/>./run.sh</code><strong>Check dependencies</strong><code>npm run doctor</code></div><p className="muted">AI research can use your local Codex ChatGPT login or an API provider. Source excerpt mode is also available. No automatic publishing is included.</p></section></div>}
  </div>;
}
