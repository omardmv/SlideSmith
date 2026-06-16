import { Plus, Trash2 } from 'lucide-react';
import type { BrainState, Preset } from '../types';
import { ViewHeader } from '../components/ViewHeader';
import { Button } from '../components/Button';

interface BrainViewProps {
  brain: BrainState;
  presets: Preset[];
  onChange: (brain: BrainState) => void;
  onPresetsChange: (presets: Preset[]) => void;
}

const inputClass =
  'w-full h-9 bg-card border border-line rounded-lg px-3 text-[13px] text-ink ' +
  'placeholder:text-ink-6 outline-none transition-colors ' +
  'focus:border-ink-7 focus:ring-2 focus:ring-ink/10';

const textareaClass =
  'w-full bg-card border border-line rounded-lg px-3 py-2.5 text-[13px] text-ink ' +
  'placeholder:text-ink-6 outline-none transition-colors resize-none ' +
  'focus:border-ink-7 focus:ring-2 focus:ring-ink/10';

function newPresetId() {
  return `preset-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

export function BrainView({ brain, presets, onChange, onPresetsChange }: BrainViewProps) {
  const updatePreset = (id: string, patch: Partial<Preset>) =>
    onPresetsChange(presets.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const addPreset = () =>
    onPresetsChange([
      ...presets,
      { id: newPresetId(), name: 'New preset', prompt: '' },
    ]);

  const removePreset = (id: string) =>
    onPresetsChange(presets.filter((p) => p.id !== id));

  return (
    <>
      <ViewHeader
        title="Brain"
        subtitle="What the AI knows about this project. Edits apply to all future generations."
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-8 space-y-8">
          {/* Niche & app */}
          <Section title="Account context" description="Rarely changes. Defines who the AI is writing for.">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Niche">
                <input
                  value={brain.niche}
                  onChange={(e) => onChange({ ...brain, niche: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="App name">
                <input
                  value={brain.appName}
                  onChange={(e) => onChange({ ...brain, appName: e.target.value })}
                  className={inputClass}
                />
              </Field>
            </div>
            <Field label="App description">
              <textarea
                value={brain.appDescription}
                onChange={(e) => onChange({ ...brain, appDescription: e.target.value })}
                rows={2}
                className={textareaClass}
              />
            </Field>
            <Field label="Audience">
              <input
                value={brain.audience}
                onChange={(e) => onChange({ ...brain, audience: e.target.value })}
                className={inputClass}
              />
            </Field>
          </Section>

          {/* Style memory */}
          <Section
            title="Style memory"
            description="The voice and patterns that work for you. Describe your hooks, slide structure, and CTAs — the AI follows this closely."
          >
            <textarea
              value={brain.styleMemory}
              onChange={(e) => onChange({ ...brain, styleMemory: e.target.value })}
              rows={16}
              className={`${textareaClass} font-mono text-[12px] leading-relaxed`}
            />
          </Section>

          {/* Presets */}
          <Section
            title="Presets"
            description="Per-batch prompt modifiers. Pick one in the Generate modal to steer a batch — educational, sales, vibe, etc. — without rewriting the Brain."
          >
            <div className="flex flex-col gap-3">
              {presets.length === 0 && (
                <p className="text-[12px] text-ink-5 italic">No presets yet. Add one to steer specific batches.</p>
              )}
              {presets.map((preset) => (
                <div key={preset.id} className="rounded-lg border border-line bg-surface p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      value={preset.name}
                      onChange={(e) => updatePreset(preset.id, { name: e.target.value })}
                      placeholder="Preset name"
                      className={`${inputClass} flex-1 h-8`}
                    />
                    <button
                      onClick={() => removePreset(preset.id)}
                      className="w-8 h-8 shrink-0 rounded-md text-ink-5 hover:text-red-600 hover:bg-red-50 flex items-center justify-center transition-colors"
                      title="Delete preset"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <textarea
                    value={preset.prompt}
                    onChange={(e) => updatePreset(preset.id, { prompt: e.target.value })}
                    rows={5}
                    placeholder="What this preset should emphasize or avoid. Injected into the prompt after the style memory."
                    className={`${textareaClass} font-mono text-[12px] leading-relaxed`}
                  />
                </div>
              ))}
              <Button variant="secondary" icon={<Plus size={13} />} onClick={addPreset}>
                Add preset
              </Button>
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-[13px] font-semibold text-ink uppercase tracking-widest">{title}</h2>
        <p className="text-[12px] text-ink-5 mt-1">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] text-ink-5 mb-1 block">{label}</label>
      {children}
    </div>
  );
}
