# Slidesmith

Generate on-brand TikTok/Instagram **carousel slideshows** with ZAI (GLM), then save the rendered slide images straight to your disk — all from a clean local dashboard you run yourself.

Slidesmith is **bring-your-own-keys** and **local-first**. There's no SaaS, no sign-up, and no database to set up. It runs on your machine and stores its config in a single file in your home directory.

---

## How it works

```
You ──▶ Brain (niche, audience, style)
          │
          ▼
   ZAI generates slideshows ──▶ Queue (review / edit / Save)
                                      │
                                      ▼
                       Slides rendered to images in the browser
                                      │
                                      ▼
                       ~/.slidesmith/exports/<project>/<NNN>-<hook>/
                          slide-01.png, slide-02.png, …, caption.txt
```

- **Generation** is done by an AI model via **ZAI** (your ZAI key) — pick any GLM model from the dropdown.
- **Slide images** are rendered locally in your browser (text over a gradient *or* a background image from the Library) — no image-gen API, no cost.
- **Backgrounds** come from a bundled **image library** of curated aesthetic packs. Want more? Scrape Pinterest with your own **Apify** key (optional).
- **Saving** writes each slideshow to its own numbered folder under `~/.slidesmith/exports/`. What you do with the PNGs after that is up to you.

## What you need

One required API key, entered in the in-app **Settings** screen:

| Key | What it's for | Where to get it |
| --- | --- | --- |
| **ZAI** | Runs the AI that writes the slideshows (any GLM model) | [docs.z.ai](https://docs.z.ai) |
| **Apify** *(optional)* | Scrape extra Pinterest images into the Library | [console.apify.com](https://console.apify.com) |

## Quick start

```bash
git clone <this-repo>
cd slidesmith
npm install
npm run dev
```

Then open the printed Vite URL (default http://localhost:5173). On first run you'll land on **Settings** — paste your ZAI key, hit **Test connection**, and you're set.

`npm run dev` starts two things together:
- the **web UI** (Vite, port 5173)
- the **local server** (Node/Express, port 8787) that holds your keys and talks to ZAI

### Production / single-process

```bash
npm run build   # build the UI
npm start       # serves the UI + API from one Node process (port 8787)
```

## Using it

1. **Projects** — each project is one brand/account, with its own Brain and background-pack selection. Switch/create them from the top-left. (Your keys and chosen model are shared across all projects.)
2. **Brain** — tell the AI who this project is: niche, app/brand, audience, and style memory. This shapes every generation.
3. **Background packs** (Settings) — pick which image packs this project draws from. *Generate* then auto-applies a background to every slide. Select none for plain gradients.
4. **Queue** — hit *Generate* and the AI writes a batch of slideshows, already wearing backgrounds. Hit **Edit** on any card to preview the carousel and tweak the caption, hashtags, per-slide text, and per-slide background.
5. **Library** — browse the bundled aesthetic packs, or scrape more images from any Pinterest search with your Apify key.
6. **Save** — hit **Save** on any queued slideshow (or select several and click **Save N** for a bulk save). Slidesmith renders each slide to an image and writes them to disk.

Each save lands in its own folder:

```
~/Documents/Slidesmith/<projectSlug>/<NNN>-<hookSlug>/
  slide-01.png
  slide-02.png
  …
  caption.txt
```

The `NNN` prefix increments per project (so the second save under a project is `002-…`, the third is `003-…`, etc.). Deleted folders aren't reused.

### A note on the bundled images

Slidesmith ships with ~140 curated background images organized into aesthetic packs (`public/library/`). They were collected from the web to get you started and may be subject to third-party copyright — they are not licensed stock. Swap in your own via the Library (scrape Pinterest with your own Apify key) if you need images you have the rights to.

## Where your data lives

- **API keys + Brain + settings:** `~/.slidesmith/config.json`
- **Generated-but-not-yet-saved drafts:** `~/.slidesmith/queue.json`
- **Saved slideshows (PNGs + captions):** `~/Documents/Slidesmith/<project>/<NNN>-<hook>/`
- **Scraped library images:** `~/.slidesmith/library/` (bundled packs live in the repo at `public/library/`)

Your keys never leave your machine except to reach the services they belong to (ZAI, Apify). The browser never sees them — they stay on the local server.

You can override the storage location with `SLIDESMITH_DIR` and the server port with `PORT` (see `.env.example`).

### Note for users upgrading from earlier versions

Earlier versions of Slidesmith scheduled posts through post-bridge and ran generation through OpenRouter. Both have been removed. Old `postbridge` and `openrouter` keys persisted in `config.json` are now ignored (safe to delete), and any non-ZAI model id is reset to `glm-5.2` on first run — re-pick your model in Settings.

## Tech

React 19 + Vite + Tailwind (UI), a small Express server (keys + ZAI proxy + disk save), and the ZAI API. No database.

## License

[PolyForm Noncommercial 1.0.0](./LICENSE) — free to use, modify, self-host, and share for any **noncommercial** purpose. Commercial use (including reselling, hosting it as a paid service, or bundling it into a product you charge for) is not permitted without separate permission from the author.
