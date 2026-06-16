import { useEffect, useState } from 'react';
import { Check, X, Loader2, KeyRound, Trash2 } from 'lucide-react';
import type { AppConfig, Project, ModelOption } from '../types';
import { ViewHeader } from '../components/ViewHeader';
import { Button } from '../components/Button';
import { testKeys, getModels } from '../lib/api';
import { PackPicker } from '../components/PackPicker';

interface SettingsViewProps {
  config: AppConfig;
  project: Project;
  canDelete: boolean;
  onSave: (patch: {
    keys?: AppConfig['keys'];
    model?: string;
    pinterestActor?: string;
    name?: string;
    imagePacks?: string[];
  }) => Promise<void>;
  onDeleteProject: () => void;
}

const inputClass =
  'w-full h-9 bg-card border border-line rounded-lg px-3 text-[13px] text-ink ' +
  'placeholder:text-ink-6 outline-none transition-colors ' +
  'focus:border-ink-7 focus:ring-2 focus:ring-ink/10';

export function SettingsView({
  config,
  project,
  canDelete,
  onSave,
  onDeleteProject,
}: SettingsViewProps) {
  const [zai, setZai] = useState(config.keys.zai);
  const [apify, setApify] = useState(config.keys.apify);
  const [pinterestActor, setPinterestActor] = useState(config.pinterestActor);
  const [model, setModel] = useState(config.model);
  const [name, setName] = useState(project.name);
  const [imagePacks, setImagePacks] = useState<string[]>(project.imagePacks);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelFilter, setModelFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [test, setTest] = useState<{ zai: boolean; apify: boolean; errors: Record<string, string> } | null>(null);

  // Re-sync editable fields when the active project changes (switching projects).
  useEffect(() => {
    setName(project.name);
    setImagePacks(project.imagePacks);
  }, [project.id, project.name, project.imagePacks]);

  useEffect(() => {
    getModels().then(setModels).catch(() => setModels([]));
  }, []);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      await onSave({
        keys: { zai, apify },
        model,
        pinterestActor,
        name,
        imagePacks,
      });
      setSaved(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      await save();
      setTest(await testKeys());
    } finally {
      setTesting(false);
    }
  };

  const filtered = modelFilter
    ? models.filter(
        (m) =>
          m.id.toLowerCase().includes(modelFilter.toLowerCase()) ||
          m.name.toLowerCase().includes(modelFilter.toLowerCase())
      )
    : models;

  return (
    <>
      <ViewHeader
        title="Settings"
        subtitle="Your own API keys, stored locally on this machine — never sent anywhere but the services they belong to."
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-8 space-y-8">
          {/* Project */}
          <Section
            title="Project"
            description="A project is one brand/account. Its Brain and background-pack selection are project-scoped — your API keys and model are shared across all projects."
          >
            <Field label="Project name">
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
            </Field>
            {canDelete && (
              <Button variant="danger-ghost" icon={<Trash2 size={13} />} onClick={onDeleteProject}>
                Delete this project
              </Button>
            )}
          </Section>

          {/* Keys (global) */}
          <Section
            title="API keys"
            description="Shared across all projects. Stored in ~/.slidesmith/config.json on your computer."
          >
            <Field label="ZAI API key" hint="Runs the AI that writes your slideshows — GLM models. Get one at docs.z.ai.">
              <input
                value={zai}
                onChange={(e) => setZai(e.target.value)}
                placeholder="zai-..."
                className={`${inputClass} font-mono`}
              />
              <TestBadge ok={test?.zai} error={test?.errors?.zai} />
            </Field>
            <Field label="Apify API key (optional)" hint="Only needed to scrape MORE Pinterest images. The bundled aesthetic packs work without it. Get one at console.apify.com.">
              <input
                value={apify}
                onChange={(e) => setApify(e.target.value)}
                placeholder="apify_api_..."
                className={`${inputClass} font-mono`}
              />
              <TestBadge ok={test?.apify} error={test?.errors?.apify} />
            </Field>
            <Field label="Pinterest Apify actor" hint="The Apify actor used for scraping. Change only if you prefer a different one.">
              <input
                value={pinterestActor}
                onChange={(e) => setPinterestActor(e.target.value)}
                placeholder="fatihtahta/pinterest-scraper-search"
                className={`${inputClass} font-mono`}
              />
            </Field>
            <Field label="Model" hint={`Pick any model ZAI offers${models.length ? ` (${models.length} available)` : '.'}`}>
              <input
                value={modelFilter}
                onChange={(e) => setModelFilter(e.target.value)}
                placeholder="Filter models… e.g. glm-5.2, glm-4.7"
                className={`${inputClass} mb-2`}
              />
              <select value={model} onChange={(e) => setModel(e.target.value)} className={inputClass}>
                {model && !filtered.some((m) => m.id === model) && <option value={model}>{model}</option>}
                {filtered.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
          </Section>

          {/* Background packs (per project) */}
          <Section
            title="Background packs"
            description="Which image packs new slideshows pull backgrounds from when you hit Generate. Select none to generate with plain gradients."
          >
            <PackPicker selected={imagePacks} onChange={setImagePacks} />
          </Section>

          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="primary"
              size="lg"
              icon={saving ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
              onClick={save}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save settings'}
            </Button>
            <Button variant="secondary" size="lg" onClick={runTest} disabled={testing || saving}>
              {testing ? <Loader2 size={13} className="animate-spin" /> : null}
              Test connection
            </Button>
            {saved && !saveError && (
              <span className="text-[12px] text-emerald-600 flex items-center gap-1">
                <Check size={13} /> Saved
              </span>
            )}
            {saveError && (
              <span className="text-[12px] text-red-600 flex items-center gap-1">
                <X size={13} /> {saveError}
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function TestBadge({ ok, error }: { ok?: boolean; error?: string }) {
  if (ok === undefined) return null;
  return ok ? (
    <p className="text-[11px] text-emerald-600 mt-1 flex items-center gap-1">
      <Check size={11} /> Connected
    </p>
  ) : (
    <p className="text-[11px] text-red-600 mt-1 flex items-center gap-1">
      <X size={11} /> {error || 'Failed'}
    </p>
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

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] text-ink-5 mb-1 block">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-ink-6 mt-1">{hint}</p>}
    </div>
  );
}
