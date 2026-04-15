# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Frontend

Run these from `front/`:

```bash
npm install
npm run dev
npm run build
npm run preview
```

- `npm run dev` starts the Vite dev server on `127.0.0.1:5173` and proxies `/api` to the backend at `http://127.0.0.1:7860`.
- `npm run build` runs `tsc --noEmit` and then builds the Vite app into `front/dist/`.
- There is currently no frontend lint or test script in `front/package.json`.

### Backend

Run from the repository root:

```bash
python zimage-codex.py
```

This starts Uvicorn with the FastAPI app on `127.0.0.1:7860`.

There is currently no Python dependency manifest, lint command, or test configuration in the repository.

## Repository workflow

- In this repository, when the user says “提交”, treat it as a request to create a git commit and push it to the configured remote.

## Architecture

This is a local Z-Image Studio app with a FastAPI backend and a Vite/TypeScript frontend.

### Backend

- `zimage-codex.py` is the backend entrypoint. It imports `backend.api:app` and runs Uvicorn on `127.0.0.1:7860`.
- `backend/api.py` defines the HTTP API and request validation. It exposes health/config/model/progress/generation endpoints under `/api/*` and serves `front/dist/` as static files when that build output exists.
- `backend/service.py` owns model configuration, model lifecycle, generation state, progress state, and image generation. Each `AVAILABLE_MODELS` entry names its local model path and Diffusers Pipeline import target; models are loaded on demand, moved to CUDA, and generate PNG responses through `backend/api.py`.
- Generation is intentionally single-job: `GENERATION_LOCK` prevents concurrent generations, `_STOP_EVENT` is checked in the Diffusers step callback, and model load/unload is guarded by `_MODEL_OPERATION_LOCK` so model lifecycle operations do not overlap with generation.
- Progress is pull-based. The generation callback updates `_PROGRESS_STATE`; the frontend polls `/api/progress` during active generation.

### Frontend

- `front/src/main.ts` is a vanilla TypeScript single-page app. It builds the DOM template, owns UI state, wires event handlers, validates/clamps generation inputs, polls progress, and handles image object URLs for preview/download/fullscreen.
- `front/src/api.ts` is the frontend API boundary. It wraps calls to `/api/config`, `/api/models`, `/api/models/load`, `/api/models/unload`, `/api/generate`, `/api/stop`, and `/api/progress`.
- `front/src/types.ts` mirrors the backend response and request payload shapes used by `api.ts` and `main.ts`.
- `front/src/styles.css` contains the full visual design and responsive layout; there is no component framework.
- `front/vite.config.ts` configures the dev server host/port and `/api` proxy to the FastAPI backend.

## Important runtime assumptions

- The backend assumes CUDA is available and calls `new_pipe.to("cuda")` plus `torch.Generator("cuda")`.
- Model paths and Pipeline import targets are currently hardcoded in `backend/service.py`. Changing model availability usually requires editing `AVAILABLE_MODELS` unless configuration support is added.
- API responses and UI copy are primarily Chinese; preserve that unless intentionally changing product language.
