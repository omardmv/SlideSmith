// Local, file-based persistence. Slidesmith is a single-user tool, so all state
// lives in a small JSON config file + a queue file under the user's home dir.
// No database — saved slideshows live on disk under ~/.slidesmith/exports/.
//
// A "project" is one brand/account you generate for. Only the Brain and the
// background-pack selection differ per project; the API keys and model are
// global. The queue (generated-but-unsaved drafts) is per project.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { bundledPackNames } from './library.js'

const DIR = process.env.SLIDESMITH_DIR || join(homedir(), '.slidesmith')
const CONFIG_PATH = join(DIR, 'config.json')
const QUEUE_PATH = join(DIR, 'queue.json')

const DEFAULT_BRAIN = {
  niche: '',
  appName: '',
  appDescription: '',
  audience: '',
  styleMemory: '',
}

// Starter presets ship with every new project. Tailored to Scrolang's
// English-learning-for-Russian-speakers positioning — the user can edit
// or delete them in the Brain tab.
const STARTER_PRESETS = [
  {
    id: 'preset-educational',
    name: 'Educational',
    prompt:
      'PRESET: Pure education. Teach one specific English phrase, rule, or mechanic. NO product pitch, NO mention of Scrolang anywhere (not in slides, not in caption, not in hashtags). End with a save CTA like «Сохрани для следующего раза» or similar situation-based save. The implicit pitch is "if they know this much for free, imagine what the app does" — never say that out loud.',
  },
  {
    id: 'preset-edu-sales',
    name: 'Educational + Sales',
    prompt:
      'PRESET: Teach first, pitch last. Slides 1–5 are pure value (a specific English phrase, rule, or mechanic with no product mention). Slide 6 is the ONLY slide that can mention Scrolang — use a conversion CTA like «Full lesson in Scrolang → link in bio» or «Try it in Scrolang, opens in Telegram». Caption may end with one Scrolang mention. Do not sell in slides 1–5 — that kills trust.',
  },
  {
    id: 'preset-antidoom',
    name: 'Anti-doomscroll vibe',
    prompt:
      'PRESET: Lifestyle / philosophy post about reclaiming scroll time. The product is NOT the point — the mindset is. Hooks are emotional or contrarian about time, attention, habits («Ты тратишь 3 часа в день на скроллинг — что если бы...»). Slides are reflective, short, almost poetic. NO English-teaching content for this preset. CTA is soft — «Подпишись, если откликнулось» or similar. The Scrolang mention (if any) goes only in the caption, not in slides.',
  },
]

function starterPresets() {
  // Fresh ids per call so cloned projects don't collide.
  return STARTER_PRESETS.map((p) => ({ ...p, id: `${p.id}-${Date.now()}-${Math.round(Math.random() * 1e6)}` }))
}

function ensureDir() {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })
}
function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}
function writeJson(path, value) {
  ensureDir()
  writeFileSync(path, JSON.stringify(value, null, 2))
}
function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e6)}`
}
function makeProject(name, brain, imagePacks) {
  return {
    id: newId('p'),
    name: name || 'Project 1',
    brain: { ...DEFAULT_BRAIN, ...brain },
    // Which background packs generation draws from. Defaults to all bundled
    // packs so a fresh project generates with images out of the box. Empty = gradients.
    imagePacks: imagePacks ?? bundledPackNames(),
    // Fresh starter presets per project so the user can edit/delete freely.
    presets: starterPresets(),
  }
}

// Normalize on every read: fill defaults and migrate legacy shapes
// (single-brain config, or projects missing the newer `presets` field) into
// the current projects[] form.
export function getConfig() {
  const s = readJson(CONFIG_PATH, {})
  let projects = Array.isArray(s.projects) && s.projects.length
    ? s.projects.map((p) => ({
        id: p.id || newId('p'),
        name: p.name || 'Project',
        brain: { ...DEFAULT_BRAIN, ...p.brain },
        imagePacks: p.imagePacks ?? bundledPackNames(),
        // Migrate: if a pre-presets project is read, seed it with the starter
        // set so the user can edit them going forward.
        presets: Array.isArray(p.presets) && p.presets.length ? p.presets : starterPresets(),
      }))
    : null

  if (!projects) {
    // Migrate a pre-projects config, or create the first project.
    const p = makeProject(s.brain?.appName || 'Project 1', s.brain)
    projects = [p]
  }

  const activeProjectId = projects.some((p) => p.id === s.activeProjectId)
    ? s.activeProjectId
    : projects[0].id

  const cfg = {
    keys: { zai: '', apify: '', ...s.keys },
    // Reset any non-ZAI model (e.g. legacy OpenRouter ids like "openai/gpt-4o-mini")
    // to the ZAI default on first read.
    model: typeof s.model === 'string' && s.model.startsWith('glm-') ? s.model : 'glm-5.2',
    pinterestActor: s.pinterestActor || 'fatihtahta/pinterest-scraper-search',
    projects,
    activeProjectId,
  }

  // If we had to synthesize/migrate projects (no valid persisted projects array,
  // the active id was stale, or a project was missing the presets field), write
  // it back once so project ids + starter presets are stable across subsequent
  // reads. Otherwise every read would mint fresh ids / fresh presets.
  const needsPersist =
    !Array.isArray(s.projects) ||
    s.projects.length !== projects.length ||
    s.activeProjectId !== activeProjectId ||
    s.projects.some((p, i) => p.id !== projects[i].id) ||
    s.projects.some((p) => !Array.isArray(p.presets) || !p.presets.length)
  if (needsPersist) writeJson(CONFIG_PATH, cfg)

  return cfg
}

function writeConfig(cfg) {
  writeJson(CONFIG_PATH, cfg)
  return cfg
}

// Global settings only (keys + model). Project data is edited via the project ops.
export function saveGlobal(patch) {
  const c = getConfig()
  return writeConfig({
    ...c,
    model: patch.model ?? c.model,
    pinterestActor: patch.pinterestActor ?? c.pinterestActor,
    keys: { ...c.keys, ...patch.keys },
  })
}

export function getActiveProject(c = getConfig()) {
  return c.projects.find((p) => p.id === c.activeProjectId) || c.projects[0]
}

export function createProject(name) {
  const c = getConfig()
  const project = makeProject(name || `Project ${c.projects.length + 1}`)
  return writeConfig({ ...c, projects: [...c.projects, project], activeProjectId: project.id })
}

export function updateProject(id, patch) {
  const c = getConfig()
  const projects = c.projects.map((p) =>
    p.id === id
      ? {
          ...p,
          name: patch.name ?? p.name,
          brain: patch.brain ? { ...p.brain, ...patch.brain } : p.brain,
          imagePacks: patch.imagePacks ?? p.imagePacks,
          presets: patch.presets ?? p.presets,
        }
      : p
  )
  return writeConfig({ ...c, projects })
}

export function deleteProject(id) {
  const c = getConfig()
  let projects = c.projects.filter((p) => p.id !== id)
  if (!projects.length) projects = [makeProject('Project 1')]
  const activeProjectId = c.activeProjectId === id ? projects[0].id : c.activeProjectId
  removeQueueFor(id)
  return writeConfig({ ...c, projects, activeProjectId })
}

export function setActiveProject(id) {
  const c = getConfig()
  if (!c.projects.some((p) => p.id === id)) throw new Error('Unknown project')
  return writeConfig({ ...c, activeProjectId: id })
}

// ── Queue (per project) ───────────────────────────────────────────────────────
function readQueueMap() {
  const m = readJson(QUEUE_PATH, {})
  return m && !Array.isArray(m) ? m : {}
}
function writeQueueMap(m) {
  writeJson(QUEUE_PATH, m)
  return m
}
export function getQueue(projectId) {
  return readQueueMap()[projectId] || []
}
export function setQueue(projectId, items) {
  const m = readQueueMap()
  m[projectId] = items
  writeQueueMap(m)
  return items
}
export function addToQueue(projectId, items) {
  return setQueue(projectId, [...items, ...getQueue(projectId)])
}
export function removeFromQueue(projectId, id) {
  return setQueue(projectId, getQueue(projectId).filter((s) => s.id !== id))
}
function removeQueueFor(projectId) {
  const m = readQueueMap()
  delete m[projectId]
  writeQueueMap(m)
}

export const CONFIG_DIR = DIR
// Exports live under Documents by default — they're user content (PNGs you'll
// post), not app data, so they shouldn't be hidden in a dotfile. Config + queue
// stay in CONFIG_DIR. Override with SLIDESMITH_EXPORTS_DIR if you want them
// elsewhere (e.g. a synced folder).
export const EXPORTS_DIR = process.env.SLIDESMITH_EXPORTS_DIR || join(homedir(), 'Documents', 'Slidesmith')
