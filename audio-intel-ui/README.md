# AudioIntel Frontend

React UI for the AudioIntel platform. Runs as a web app in dev (port 5173)
and as a Tauri desktop app in production (Rust shell + the same React bundle).

For overall project context, prerequisites, and the one-command run, see the
[root README](../README.md).

## Stack

- **React 19** + **TypeScript** + **Vite** + the React Compiler
- **Tailwind CSS 4** for styling
- **shadcn/ui** primitives (Radix under the hood) for accessible dialogs, dropdowns, tabs, tooltips
- **lucide-react** icons
- **react-router-dom 7** for routing
- **recharts** for dashboard charts
- **Tauri** (Rust) for the desktop shell — see [src-tauri/](src-tauri/)

## Where things live

| Folder | What's there |
|--------|--------------|
| [src/components/](src/components/) | Page components — one file per route (Dashboard, AudioAnalysis, Settings, UserManagement, etc.) |
| [src/lib/api.ts](src/lib/api.ts) | All HTTP calls. Backend on `127.0.0.1:8001`, ML on `127.0.0.1:8000`. Grouped namespaces: `auth`, `audios`, `speakers`, `suggestions`, `relations`, `alerts`, `stats`, `users`, `ml`. |
| [src/App.tsx](src/App.tsx) | Router + auth gate + force-password-change flow |
| [src-tauri/](src-tauri/) | Rust desktop shell (build with `npm run tauri:build`) |

## Talking to the services

The UI talks to the **Backend** for everything stateful — speakers, audios,
segments, suggestions, auth. The ML service is only hit directly for
`POST /analyze` from inside the Backend, never from the UI. (The Settings
"Add voice profile" flow uses Backend's `POST /speakers/enroll`, which
internally calls ML's `POST /speakers/embed`.)

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Vite dev server only (web mode, port 5173) |
| `npm run tauri:dev` | Vite + Tauri desktop app (used by the root `npm run dev` / `dev:ml`) |
| `npm run build` | Production web bundle to `dist/` |
| `npm run tauri:build` | Production desktop binary |
| `npm run lint` | ESLint over `src/` |

For day-to-day work, run from the project root:

```bash
npm run dev:ml    # Backend + ML in Docker, then opens the Tauri desktop app
```
