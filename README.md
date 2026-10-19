# Rhythia Web

An **unofficial** browser port of [Rhythia](https://github.com/Rhythia) (formerly Sound Space Plus), an
aim-based rhythm game played on a 3×3 grid. Built for browsers and devices that the official Godot/C#
client does not support, including phones, tablets, Chromebooks and macOS.

> **Not affiliated with Rhythia, CAPO Games, Steam Rhythia or rhythia.com.**
> This is a community fan project. Please download the official client from the links on the
> [Rhythia GitHub organisation](https://github.com/Rhythia) if you can run it.

## Status

Playable beta. Currently implemented:

- Map import and parsing for `.sspm` (v1 + v2), `.phxm`, `.rhm` and legacy `.txt` maps
- A local map library backed by IndexedDB, with covers, best scores and delete/re-import
- Web Audio driven gameplay: audio clock, latency compensation and hit sounds
- Faithful hit rules and scoring ported from the current client (55 ms late window, 0.57 hitbox,
  score/combo multipliers, accuracy and health)
- three.js 3×3 playfield with a perspective note tunnel, hit effects and live HUD
- Mouse and touch aiming (absolute mapping, adjustable finger offset), countdown, pause/resume,
  retry and results screens
- Scroll speed, approach rate, volume, note offset and touch offset settings

Coming next: PWA/offline support, replays and more visual polish.

## Controls

- **Aim:** move the mouse or drag a finger. The cursor follows your pointer 1:1; touch input uses an
  adjustable finger offset so your hand does not cover the target.
- **Hit notes:** hover over a note's cell as it reaches the grid. Notes can be hit from their timestamp
  until 55 ms (real time at 1× speed) afterwards.
- **Pause / resume:** `Esc`, `P` or `Space`, or the pause button. Settings changed while paused apply
  immediately, except scroll speed and approach rate which apply on retry.
- **Calibration:** if notes feel early or late, adjust **Note offset** in the settings or pause menu.
  Positive values make notes arrive later.

## How it works

This is a from-scratch TypeScript client, not a Godot export. The current official client is written in
Godot 4 + C#, which cannot be exported to the web (Godot does not support C# web exports), so the game is
being reimplemented for the browser with:

- **three.js** for the playfield
- the **Web Audio API** as the game clock (low-latency audio scheduling and output-latency compensation)
- native parsers for the map formats, written against the public SSPM specification and the formats used
  by the official client
- **IndexedDB** for local map, score and cover storage

Maps are loaded from local files only. Nothing is uploaded, and the app does not redistribute any music.

## Development

Requirements: Node.js 22+ and pnpm 11+.

```bash
pnpm install
pnpm dev        # local dev server
pnpm test       # unit tests (parsers + gameplay rules)
pnpm test:e2e   # browser tests (uses installed Edge on Windows)
pnpm build      # typecheck + production build into dist/
pnpm preview    # preview the production build
```

### Testing with real maps

Put a few of your own map files in `samples/` (git-ignored) and run:

```bash
pnpm test
```

The sample test automatically picks up every `.sspm`/`.phxm`/`.rhm`/`.txt` file in that folder and checks
that it parses. No copyrighted content is committed to this repository.

## Deployment (GitHub Pages)

The repository is set up for GitHub Actions deployment:

1. Push to `main`.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. The workflow runs tests, builds with the base path `/rhythia-web/`, and publishes `dist/`.

If you rename the repository or use a custom domain, set `BASE_PATH` accordingly when building
(`BASE_PATH=/ pnpm build` for a root domain).

## License

[GNU Affero General Public License v3.0 or later](LICENSE) — matching the current official client.

Map format notes are based on the publicly documented
[SSPM specification](https://basils-garden.github.io/types/sspm/v2.html) and the open-source
[Sound Space Plus](https://github.com/Rhythia/sound-space-plus) (MIT) and
[Rhythia Client](https://github.com/Rhythia/Client) (AGPL-3.0) projects.
