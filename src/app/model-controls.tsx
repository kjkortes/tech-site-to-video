'use client';
import { useId, useState } from 'react';
import { ModelOptions, ModelChoice, ModelProvider, reasoningEfforts, creativeDirections, effortLabels, creativityLabels } from '@/lib/model-options';

export function ModelControls({ value, onChange, models, provider, disabled = false }: {
  value: ModelOptions; onChange: (value: ModelOptions) => void; models: ModelChoice[]; provider: ModelProvider; disabled?: boolean;
}) {
  const id = useId();
  const [custom, setCustom] = useState(false);
  const known = models.find(m => m.id === value.model);
  const isCustom = custom || (!!value.model && !known) || provider === 'api';
  const supported = known ? ['default', ...known.efforts] : reasoningEfforts;
  const efforts = provider === 'codex' ? supported : ['default'];
  const inactive = disabled || provider === 'extractive';
  function selectModel(model: string) {
    const choice = models.find(m => m.id === model);
    const effort = value.effort === 'default' || !choice || choice.efforts.includes(value.effort) ? value.effort : choice.defaultEffort;
    onChange({ ...value, model, effort });
  }
  return <fieldset className="model-controls" disabled={inactive}>
    <div className="model-field model-choice"><label htmlFor={`${id}-model`}>GPT model</label>
      <select id={`${id}-model`} value={isCustom ? '__custom__' : value.model} onChange={e => {
        if (e.target.value === '__custom__') setCustom(true);
        else { setCustom(false); selectModel(e.target.value); }
      }}>
        <option value="">{provider === 'codex' ? 'Codex default (recommended)' : 'Configured model'}</option>
        {models.filter(m => m.vision).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        <option value="__custom__">Custom model ID…</option>
      </select>
      {isCustom && <input aria-label="Custom model ID" value={value.model} maxLength={160} pattern="[a-zA-Z0-9._:/\-]*" placeholder="Enter a model ID" onChange={e => selectModel(e.target.value)} />}
    </div>
    <div className="model-field"><label htmlFor={`${id}-effort`}>Reasoning effort</label><select id={`${id}-effort`} value={value.effort} disabled={inactive || provider !== 'codex'} onChange={e => onChange({ ...value, effort: e.target.value as ModelOptions['effort'] })}>
      {[...new Set(efforts)].map(effort => <option value={effort} key={effort}>{effortLabels[effort as ModelOptions['effort']]}</option>)}
    </select></div>
    <div className="model-field"><label htmlFor={`${id}-creativity`}>Creative direction</label><select id={`${id}-creativity`} value={value.creativity} onChange={e => onChange({ ...value, creativity: e.target.value as ModelOptions['creativity'] })}>
      {creativeDirections.map(direction => <option key={direction} value={direction}>{creativityLabels[direction]}</option>)}
    </select></div>
    <p className="model-help">{provider === 'codex' ? 'More effort gives the model room for deeper planning and may take longer. Creative direction guides the story and visuals; factual checks always apply.' : provider === 'api' ? 'Use a model ID from your API provider. Reasoning effort is currently available for Codex.' : 'Source excerpt mode does not use a GPT model.'}</p>
  </fieldset>;
}
