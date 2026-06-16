import { useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { GenerateModal } from './components/GenerateModal';
import { SlideshowEditorModal } from './components/SlideshowEditorModal';
import { BulkSaveModal } from './components/BulkSaveModal';
import { QueueView } from './views/QueueView';
import { LibraryView } from './views/LibraryView';
import { BrainView } from './views/BrainView';
import { SettingsView } from './views/SettingsView';
import { renderSlideshow } from './lib/render';
import * as api from './lib/api';
import type { AppConfig, Project, Slideshow, Slide, BrainState, Preset, ViewKey } from './types';

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [activeView, setActiveView] = useState<ViewKey>('queue');
  const [queue, setQueue] = useState<Slideshow[]>([]);
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState<Slideshow | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkSaveOpen, setBulkSaveOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const hasZai = !!config?.keys.zai;
  const hasApify = !!config?.keys.apify;
  const activeProject: Project | undefined = config?.projects.find(
    (p) => p.id === config.activeProjectId
  ) ?? config?.projects[0];

  useEffect(() => {
    (async () => {
      try {
        const cfg = await api.getConfig();
        setConfig(cfg);
        setQueue(await api.getQueue());
        if (!cfg.keys.zai) setActiveView('settings');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not reach the Slidesmith server.');
      }
    })();
  }, []);

  const generate = async (count: number, packs: string[], presetId: string) => {
    setError(null);
    setGenerating(true);
    try {
      await api.generate(count, packs, presetId || undefined);
      setQueue(await api.getQueue());
      setGenerateOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const reject = async (id: string) => {
    setQueue(await api.removeFromQueue(id));
  };

  // Keep the multi-select in sync as queue items come and go.
  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => queue.some((s) => s.id === id)));
  }, [queue]);

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const bulkDone = () => {
    setBulkSaveOpen(false);
    setSelectedIds([]);
  };

  const saveEdits = async (patch: { slides: Slide[]; caption: string; hashtags: string[] }) => {
    if (!editing) return;
    setQueue(await api.updateSlideshow(editing.id, patch));
    setEditing(null);
  };

  // Render the slideshow client-side, POST the PNGs to the server, and show
  // the resulting disk path as a transient banner.
  const saveSlideshow = async (id: string) => {
    setError(null);
    setSavedPath(null);
    const show = queue.find((s) => s.id === id);
    if (!show) return;
    try {
      const slides = await renderSlideshow(show);
      const { path } = await api.saveSlideshow(id, { slides, caption: show.caption, hashtags: show.hashtags });
      setSavedPath(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Global settings (keys/model) + per-project edits (name/imagePacks), in one call.
  const saveSettings = async (patch: {
    keys?: AppConfig['keys'];
    model?: string;
    pinterestActor?: string;
    name?: string;
    imagePacks?: string[];
  }) => {
    if (patch.keys || patch.model !== undefined || patch.pinterestActor !== undefined) {
      await api.saveConfig({ keys: patch.keys, model: patch.model, pinterestActor: patch.pinterestActor });
    }
    if (activeProject && (patch.name !== undefined || patch.imagePacks)) {
      await api.updateProject(activeProject.id, {
        name: patch.name,
        imagePacks: patch.imagePacks,
      });
    }
    setConfig(await api.getConfig());
  };

  const saveBrain = async (brain: BrainState) => {
    if (!activeProject) return;
    // Optimistic local update so typing stays snappy, then persist.
    setConfig((c) =>
      c
        ? { ...c, projects: c.projects.map((p) => (p.id === activeProject.id ? { ...p, brain } : p)) }
        : c
    );
    await api.updateProject(activeProject.id, { brain });
  };

  const savePresets = async (presets: Preset[]) => {
    if (!activeProject) return;
    setConfig((c) =>
      c
        ? { ...c, projects: c.projects.map((p) => (p.id === activeProject.id ? { ...p, presets } : p)) }
        : c
    );
    await api.updateProject(activeProject.id, { presets });
  };

  const switchProject = async (id: string) => {
    setConfig(await api.activateProject(id));
    setQueue(await api.getQueue());
  };

  const newProject = async () => {
    setConfig(await api.createProject());
    setQueue(await api.getQueue());
    setActiveView('settings');
  };

  const removeProject = async (id: string) => {
    setConfig(await api.deleteProject(id));
    setQueue(await api.getQueue());
  };

  if (!config || !activeProject) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-bg text-ink-5 text-[13px]">
        {error ? <span className="text-red-600 max-w-sm text-center">{error}</span> : 'Loading…'}
      </div>
    );
  }

  return (
    <div className="flex h-full w-full bg-bg text-ink">
      <Sidebar
        activeView={activeView}
        onSelectView={setActiveView}
        queueCount={queue.length}
        projects={config.projects}
        activeProjectId={config.activeProjectId}
        onSwitchProject={switchProject}
        onNewProject={newProject}
      />
      <main className="flex-1 h-full overflow-hidden flex flex-col">
        {error && activeView !== 'settings' && (
          <div className="px-8 py-2 bg-red-50 border-b border-red-200 text-[12px] text-red-700">
            {error}
          </div>
        )}
        {savedPath && activeView === 'queue' && (
          <div className="px-8 py-2 bg-emerald-50 border-b border-emerald-200 text-[12px] text-emerald-700 flex items-center justify-between">
            <span>Saved → <span className="font-mono">{savedPath}</span></span>
            <button onClick={() => setSavedPath(null)} className="text-emerald-700/70 hover:text-emerald-700">dismiss</button>
          </div>
        )}

        {activeView === 'queue' && (
          <QueueView
            slideshows={queue}
            generating={generating}
            canGenerate={hasZai}
            onGenerate={() => setGenerateOpen(true)}
            selectedIds={selectedIds}
            onSave={saveSlideshow}
            onReject={reject}
            onEdit={(id) => setEditing(queue.find((s) => s.id === id) || null)}
            onToggleSelect={toggleSelect}
            onSelectAll={() => setSelectedIds(queue.map((s) => s.id))}
            onClearSelection={() => setSelectedIds([])}
            onBulkSave={() => setBulkSaveOpen(true)}
          />
        )}
        {activeView === 'library' && <LibraryView hasApify={hasApify} />}
        {activeView === 'brain' && (
          <BrainView
            brain={activeProject.brain}
            presets={activeProject.presets}
            onChange={saveBrain}
            onPresetsChange={savePresets}
          />
        )}
        {activeView === 'settings' && (
          <SettingsView
            config={config}
            project={activeProject}
            canDelete={config.projects.length > 1}
            onSave={saveSettings}
            onDeleteProject={() => removeProject(activeProject.id)}
          />
        )}
      </main>

      {editing && (
        <SlideshowEditorModal
          slideshow={editing}
          onClose={() => setEditing(null)}
          onSave={saveEdits}
        />
      )}

      {bulkSaveOpen && selectedIds.length > 0 && (
        <BulkSaveModal
          slideshows={queue.filter((s) => selectedIds.includes(s.id))}
          onClose={() => setBulkSaveOpen(false)}
          onDone={bulkDone}
        />
      )}

      {generateOpen && (
        <GenerateModal
          defaultPacks={activeProject.imagePacks}
          presets={activeProject.presets}
          defaultPresetId=""
          generating={generating}
          onClose={() => setGenerateOpen(false)}
          onGenerate={generate}
        />
      )}
    </div>
  );
}
