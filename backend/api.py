from __future__ import annotations

from io import BytesIO
from pathlib import Path

from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backend import service

ROOT_DIR = Path(__file__).resolve().parent.parent
FRONT_DIST_DIR = ROOT_DIR / "front" / "dist"

app = FastAPI(title="Z-Image Studio")


class GenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    ratio: str
    steps: int = Field(..., ge=service.MIN_STEPS, le=service.MAX_STEPS)
    guidance_scale: float = Field(
        ..., ge=service.MIN_GUIDANCE_SCALE, le=service.MAX_GUIDANCE_SCALE
    )
    seed: int = Field(..., ge=service.SEED_MIN, le=service.SEED_MAX)


class ModelLoadRequest(BaseModel):
    model_id: str


@app.get("/api/health")
def healthcheck() -> dict[str, object | None]:
    return {"status": "ok", "model": service.get_model_snapshot()}


@app.get("/api/config")
def get_config() -> dict:
    return {
        "aspect_ratios": [
            {"label": label, "width": width, "height": height}
            for label, (width, height) in service.ASPECT_RATIOS.items()
        ],
        "defaults": {
            "ratio": service.DEFAULT_RATIO,
            "steps": service.DEFAULT_STEPS,
            "guidance_scale": service.DEFAULT_GUIDANCE_SCALE,
            "initial_seed": service.randomize_seed(),
            "prompt_placeholder": service.PROMPT_PLACEHOLDER,
        },
        "limits": {
            "steps": {
                "min": service.MIN_STEPS,
                "max": service.MAX_STEPS,
                "step": service.STEPS_STEP,
            },
            "guidance_scale": {
                "min": service.MIN_GUIDANCE_SCALE,
                "max": service.MAX_GUIDANCE_SCALE,
                "step": service.GUIDANCE_STEP,
            },
            "seed": {
                "min": service.SEED_MIN,
                "max": service.SEED_MAX,
                "step": 1,
            },
        },
    }


@app.get("/api/models")
def get_models() -> dict[str, object | None]:
    return service.get_models_payload()


@app.post("/api/models/load")
def load_model(payload: ModelLoadRequest) -> dict[str, object | None]:
    model_id = payload.model_id.strip()
    if not model_id:
        raise HTTPException(status_code=422, detail="Model id is required.")

    try:
        return service.load_model(model_id)
    except service.UnknownModel as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except service.ModelOperationBusy as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@app.post("/api/models/unload")
def unload_model() -> dict[str, object | None]:
    try:
        return service.unload_model()
    except service.ModelOperationBusy as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@app.get("/api/progress")
def get_progress() -> dict[str, object | None]:
    return service.get_progress_snapshot()


@app.post("/api/generate")
def generate_image(payload: GenerateRequest):
    prompt = payload.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=422, detail="Prompt is required.")
    if payload.ratio not in service.ASPECT_RATIOS:
        raise HTTPException(status_code=422, detail="Unsupported ratio.")
    if not service.GENERATION_LOCK.acquire(blocking=False):
        raise HTTPException(
            status_code=409,
            detail="A generation is already running. Please stop it or wait for it to finish.",
        )

    try:
        image = service.generate_image_from_z(
            prompt=prompt,
            ratio=payload.ratio,
            steps=payload.steps,
            guidance_scale=payload.guidance_scale,
            seed=payload.seed,
        )
        if image is None:
            return Response(status_code=204)

        buffer = BytesIO()
        image.save(buffer, format="PNG")
        buffer.seek(0)
        return StreamingResponse(
            buffer,
            media_type="image/png",
            headers={"Cache-Control": "no-store"},
        )
    except service.ModelNotReady as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    finally:
        service.GENERATION_LOCK.release()


@app.post("/api/stop")
def stop_generation() -> dict[str, str]:
    if not service.GENERATION_LOCK.locked():
        return {"status": "idle"}

    service.request_stop()
    return {"status": "stopping"}


if FRONT_DIST_DIR.exists():
    app.mount("/", StaticFiles(directory=FRONT_DIST_DIR, html=True), name="frontend")
else:

    @app.get("/", include_in_schema=False)
    def frontend_not_built() -> HTMLResponse:
        return HTMLResponse(
            """
            <!doctype html>
            <html lang=\"zh-CN\">
              <head>
                <meta charset=\"utf-8\" />
                <title>Z-Image Studio</title>
              </head>
              <body style=\"font-family: sans-serif; padding: 24px;\">
                <h1>前端尚未构建</h1>
                <p>请先在 <code>front/</code> 目录下安装依赖并执行构建，或使用 Vite 开发服务器启动独立前端。</p>
              </body>
            </html>
            """
        )
