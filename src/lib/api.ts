// Frontend API client. All calls go to the local Slidesmith server (proxied at
// /api in dev, same-origin in production). The server holds the keys and talks
// to ZAI — the browser never sees the secrets in a request.
import type {
  AppConfig,
  Project,
  Slideshow,
  ModelOption,
  LibraryImage,
  LibraryPack,
  SaveResult,
} from '../types';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'content-type': 'application/json' },
    cache: 'no-store', // always hit the server — never a stale Queue list
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || res.statusText);
  return body as T;
}

export const getConfig = () => req<AppConfig>('/config');

// Global settings only (keys + model + scraper actor).
export const saveConfig = (patch: { keys?: AppConfig['keys']; model?: string; pinterestActor?: string }) =>
  req<AppConfig>('/config', { method: 'PUT', body: JSON.stringify(patch) });

// Projects — each has its own Brain + background-pack selection.
export const createProject = (name?: string) =>
  req<AppConfig>('/projects', { method: 'POST', body: JSON.stringify({ name }) });

export const updateProject = (
  id: string,
  patch: Partial<Pick<Project, 'name' | 'brain' | 'imagePacks' | 'presets'>>
) => req<AppConfig>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(patch) });

export const deleteProject = (id: string) =>
  req<AppConfig>(`/projects/${id}`, { method: 'DELETE' });

export const activateProject = (id: string) =>
  req<AppConfig>(`/projects/${id}/activate`, { method: 'POST' });

export const testKeys = () =>
  req<{ zai: boolean; apify: boolean; errors: Record<string, string> }>(
    '/config/test',
    { method: 'POST' }
  );

export const getModels = () => req<ModelOption[]>('/models');

export const getQueue = () => req<Slideshow[]>('/queue');

export const generate = (count = 4, packs?: string[], presetId?: string) =>
  req<Slideshow[]>('/generate', { method: 'POST', body: JSON.stringify({ count, packs, presetId }) });

export const removeFromQueue = (id: string) =>
  req<Slideshow[]>(`/queue/${id}`, { method: 'DELETE' });

export const updateSlideshow = (
  id: string,
  patch: Partial<Pick<Slideshow, 'slides' | 'caption' | 'hashtags' | 'hook'>>
) => req<Slideshow[]>(`/queue/${id}`, { method: 'PUT', body: JSON.stringify(patch) });

// Save a rendered slideshow to disk. Server writes PNGs + caption.txt to its
// own numbered folder under ~/.slidesmith/exports/<project>/.
export const saveSlideshow = (
  id: string,
  payload: { slides: string[]; caption: string; hashtags: string[] }
) => req<SaveResult>(`/save/${id}`, { method: 'POST', body: JSON.stringify(payload) });

// ── Image library ─────────────────────────────────────────────────────────────
export const getLibrary = () => req<LibraryImage[]>('/library');

export const getPacks = () => req<LibraryPack[]>('/library/packs');

export const scrapePinterest = (searches: string[], count: number) =>
  req<{ added: number; found: number }>('/library/scrape', {
    method: 'POST',
    body: JSON.stringify({ searches, count }),
  });

export const deleteLibraryImage = (id: string) =>
  req<LibraryImage[]>(`/library/${encodeURIComponent(id)}`, { method: 'DELETE' });
