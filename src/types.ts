export type ViewKey = 'queue' | 'library' | 'brain' | 'settings';

export interface Slide {
  id: string;
  text: string;
  // Generated slides have no source image — they're rendered from text over a
  // gradient. `imageUrl` is kept optional for backwards-compat / future use.
  imageUrl?: string;
  bgFrom?: string;
  bgTo?: string;
}

export interface Slideshow {
  id: string;
  hook: string;
  caption: string;
  hashtags: string[];
  slides: Slide[];
  createdAt: string;
  rationale: string;
}

export interface BrainState {
  niche: string;
  appName: string;
  appDescription: string;
  audience: string;
  styleMemory: string;
}

export interface Project {
  id: string;
  name: string;
  brain: BrainState;
  imagePacks: string[]; // background packs generation draws from ([] = gradients only)
  presets: Preset[]; // user-editable generation presets (Educational, Sales, etc.)
}

export interface Preset {
  id: string;
  name: string;
  // Injected verbatim into the prompt between style memory and JSON shape spec.
  prompt: string;
}

export interface AppConfig {
  keys: { zai: string; apify: string };
  model: string;
  pinterestActor: string;
  projects: Project[];
  activeProjectId: string;
}

export interface LibraryImage {
  id: string;
  url: string;
  pack: string;
  source: 'bundled' | 'scraped';
}

export interface LibraryPack {
  name: string;
  source: 'bundled' | 'scraped';
  count: number;
  covers: string[];
}

export interface ModelOption {
  id: string;
  name: string;
}

// Result of POST /api/save/:id — the absolute path the slideshow was written to.
export interface SaveResult {
  path: string;
}
