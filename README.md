# orbyt-site

Landing page for **orbyt**, a 3D engine that AI agents drive. Live at https://www.orbyt3d.space

A static site with no build step and no dependencies to install. Three.js (v0.160) is loaded from the jsDelivr CDN.

| Path | What it is |
|---|---|
| `index.html` | Landing page |
| `showcase.html` | Live, orbitable 3D scenes (`?scene=launch`, `servers` or `wind`) |
| `docs/` | Getting started, models and agents (MCP), performance |
| `changelog.html` | Release notes |
| `js/site3d.js` | Shared 3D code: scene builders, renderer and post-processing, hero, showcase stills |
| `css/pages.css`, `img/` | Styles for secondary pages, icon sprite, logo |

## What's on the page

- **Live 3D hero:** a night-time launch complex rendered with Three.js and bloom. The camera cycles through five shots and can be dragged to orbit.
- **Animated background:** ordered (Bayer 8×8) dither dots driven by orbiting light blobs, ambient glows, film grain and a cursor-following light.
- **Showcase images** (launch site, server hall, wind farm) are rendered in the browser from procedural scenes when the visitor scrolls near them.
- Install tabs for npm / pnpm / Yarn / Bun, copy buttons, scroll reveals, and a responsive layout down to phone width.

## Run it locally

The pages load ES modules, so serve the folder rather than opening files directly:

```bash
python -m http.server 5173
```

Then visit http://localhost:5173.

## Deploy

Hosted on [Vercel](https://vercel.com) as a static site (framework preset: **Other**, no build command).
`vercel.json` adds security headers (CSP allowing only this site and `cdn.jsdelivr.net`, HSTS,
`nosniff`, no framing). Every push to `main` redeploys automatically.

## Performance notes

- Static meshes are merged per material and the shadow map is drawn once, so the hero runs at ~130 draw calls per frame.
- Render resolution follows the screen with a pixel budget, and steps down automatically if frames drop below ~45 fps.
- Respects `prefers-reduced-motion`.
