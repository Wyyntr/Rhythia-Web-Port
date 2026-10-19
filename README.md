# Rhythia Web

An **unofficial** browser port of [Rhythia](https://github.com/Rhythia) (formerly Sound Space Plus), an
aim-based rhythm game played on a 3×3 grid. Built for browsers and devices that the official Godot/C#
client does not support, including phones, tablets, Chromebooks and macOS.

> **Not affiliated with Rhythia, CAPO Games, Steam Rhythia or rhythia.com.**
> This is a community fan project. Please download the official client from the links on the
> [Rhythia GitHub organisation](https://github.com/Rhythia) if you can run it.

## Status

Early development. Currently implemented:

- Map import and parsing for `.sspm` (v1 + v2), `.phxm`, `.rhm` and legacy `.txt` maps
- A local map browser for inspecting imported maps (nothing is uploaded anywhere)

Coming next: audio engine, gameplay, touch input, PWA/offline support and replays.

## How it works

This is a from-scratch TypeScript client, not a Godot export. The current official client is written in
Godot 4 + C#, which cannot be exported to the web (Godot does not support C# web exports), so the game is
being reimplemented for the browser with:

- **three.js** for the playfield
- the **Web Audio API** as the game clock (low-latency audio scheduling)
- native parsers for the map formats, written against the public SSPM specification and the formats used
  by the official client
- **IndexedDB** for local map storage (coming in the next milestone)

Maps are loaded from local files only. Nothing is uploaded, and the app does not redistribute any music.

## Development

Requirements: Node.js 22+ and pnpm 11+.

```bash
pnpm install
pnpm dev        # local dev server
pnpm test       # unit tests (map parsers)
pnpm test:e2e   # browser smoke tests (uses installed Edge on Windows)
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
