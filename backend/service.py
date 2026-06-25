from __future__ import annotations

import gc
import random
import threading
import time
from importlib import import_module
from typing import Any, Final, Protocol, TypedDict, cast

import torch
from PIL import Image

class PipelineClass(Protocol):
    @classmethod
    def from_pretrained(cls, model_path: str, **kwargs: object) -> Any: ...


class ModelConfig(TypedDict):
    label: str
    path: str
    pipeline_module: str
    pipeline_class: str


DEFAULT_MODEL_ID: Final = "Z-Image-Turbo"
AVAILABLE_MODELS: Final[dict[str, ModelConfig]] = {
    "Z-Image-Turbo": {
        "label": "Z-Image-Turbo",
        "path": "D:/Dev/Model/aigc/Z-Image-Turbo",
        "pipeline_module": "diffusers.pipelines.z_image.pipeline_z_image",
        "pipeline_class": "ZImagePipeline",
    },
    "ERNIE-Image": {
        "label": "ERNIE-Image",
        "path": "D:/Dev/Model/aigc/ERNIE-Image",
        "pipeline_module": "diffusers.pipelines.ernie_image.pipeline_ernie_image",
        "pipeline_class": "ErnieImagePipeline",
    },
}
DEFAULT_RATIO: Final = "16:9"
DEFAULT_STEPS: Final = 8
DEFAULT_GUIDANCE_SCALE: Final = 1.0
MIN_STEPS: Final = 4
MAX_STEPS: Final = 20
STEPS_STEP: Final = 1
MIN_GUIDANCE_SCALE: Final = 0.0
MAX_GUIDANCE_SCALE: Final = 3.0
GUIDANCE_STEP: Final = 0.1
SEED_MIN: Final = 1
SEED_MAX: Final = 2_147_483_647
PROMPT_PLACEHOLDER: Final = "一只穿宇航服的小狐狸，电影级边缘光，金属细节，体积光，超高细节"

ASPECT_RATIOS: Final[dict[str, tuple[int, int]]] = {
    "1:1": (1024, 1024),
    "16:9": (1344, 768),
    "9:16": (768, 1344),
    "4:3": (1152, 864),
    "3:4": (864, 1152),
}

NEGATIVE_PROMPT: Final = (
    "low quality, blurry, noisy, distorted anatomy, bad hands, "
    "text artifacts, watermark, overexposed, oversaturated, ai look"
)

GENERATION_LOCK = threading.Lock()
_MODEL_LOCK = threading.Lock()
_MODEL_OPERATION_LOCK = threading.Lock()
_PROGRESS_LOCK = threading.Lock()
_STOP_EVENT = threading.Event()
_PROGRESS_STATE: dict[str, object | None] = {
    "status": "idle",
    "message": "准备就绪，可开始生成。",
    "progress": 0,
    "current_step": 0,
    "total_steps": 0,
    "is_generating": False,
    "ratio": None,
    "seed": None,
    "updated_at": None,
}
_MODEL_STATE: dict[str, object | None] = {
    "status": "unloaded",
    "current_model": None,
    "current_model_path": None,
    "message": "模型尚未加载。",
    "is_busy": False,
    "updated_at": None,
}
_pipe: Any | None = None


class GenerationStopped(Exception):
    """Raised when a running diffusion job is requested to stop."""


class ModelNotReady(Exception):
    """Raised when generation is requested before a model is usable."""


class ModelOperationBusy(Exception):
    """Raised when another model lifecycle operation is active."""


class UnknownModel(Exception):
    """Raised when the requested model id is not registered."""


def _update_progress(**changes: object | None) -> None:
    with _PROGRESS_LOCK:
        _PROGRESS_STATE.update(changes)
        _PROGRESS_STATE["updated_at"] = time.time()


def _release_cuda_memory() -> None:
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        try:
            torch.cuda.ipc_collect()
        except Exception:
            pass


def _get_pipeline_class(model: ModelConfig) -> PipelineClass:
    module = import_module(model["pipeline_module"])
    pipeline_class = getattr(module, model["pipeline_class"])
    return cast(PipelineClass, pipeline_class)


def get_progress_snapshot() -> dict[str, object | None]:
    with _PROGRESS_LOCK:
        return dict(_PROGRESS_STATE)


def list_models() -> list[dict[str, str]]:
    return [
        {"id": model_id, "label": model["label"], "path": model["path"]}
        for model_id, model in AVAILABLE_MODELS.items()
    ]


def get_model_snapshot() -> dict[str, object | None]:
    with _MODEL_LOCK:
        snapshot = dict(_MODEL_STATE)
    snapshot["is_busy"] = bool(snapshot["is_busy"]) or _MODEL_OPERATION_LOCK.locked()
    return snapshot


def get_models_payload() -> dict[str, object | None]:
    return {
        "available_models": list_models(),
        "default_model_id": DEFAULT_MODEL_ID,
        "state": get_model_snapshot(),
    }


def randomize_seed() -> int:
    return random.randint(SEED_MIN, SEED_MAX)


def request_stop() -> None:
    _STOP_EVENT.set()
    snapshot = get_progress_snapshot()
    if snapshot["is_generating"]:
        _update_progress(status="stopping", message="正在停止当前生成，请稍候…")


def get_loaded_pipeline_or_raise() -> Any:
    with _MODEL_LOCK:
        if _pipe is None or _MODEL_STATE["status"] != "loaded":
            message = str(_MODEL_STATE.get("message") or "模型尚未加载。")
            raise ModelNotReady(message)
        return _pipe


def load_model(model_id: str) -> dict[str, object | None]:
    global _pipe

    if model_id not in AVAILABLE_MODELS:
        raise UnknownModel(f"未知模型：{model_id}")
    if GENERATION_LOCK.locked():
        raise ModelOperationBusy("生成任务正在运行，请停止或等待完成后再加载模型。")
    if not _MODEL_OPERATION_LOCK.acquire(blocking=False):
        raise ModelOperationBusy("已有模型操作正在进行，请稍候。")

    model = AVAILABLE_MODELS[model_id]
    model_path = model["path"]
    old_pipe: Any | None = None
    old_model_id: str | None = None
    old_model_path: str | None = None
    new_pipe: Any | None = None
    restored_pipe: Any | None = None
    is_switching = False
    try:
        with _MODEL_LOCK:
            if _pipe is not None and _MODEL_STATE["current_model"] == model_id:
                _MODEL_STATE.update(
                    status="loaded",
                    current_model=model_id,
                    current_model_path=model_path,
                    message="模型已加载。",
                    is_busy=False,
                    updated_at=time.time(),
                )
                return dict(_MODEL_STATE)

            is_switching = _pipe is not None
            status = "switching" if is_switching else "loading"
            message = (
                f"正在切换到模型 {model['label']}…"
                if is_switching
                else f"正在加载模型 {model['label']}…"
            )
            old_pipe = _pipe
            old_model_id = str(_MODEL_STATE["current_model"]) if _MODEL_STATE["current_model"] else None
            old_model_path = (
                str(_MODEL_STATE["current_model_path"])
                if _MODEL_STATE["current_model_path"]
                else None
            )
            _pipe = None
            _MODEL_STATE.update(
                status=status,
                current_model=None,
                current_model_path=None,
                message=message,
                is_busy=True,
                updated_at=time.time(),
            )

        if old_pipe is not None:
            del old_pipe
            old_pipe = None
            _release_cuda_memory()

        pipeline_class = _get_pipeline_class(model)
        new_pipe = pipeline_class.from_pretrained(
            model_path,
            torch_dtype=torch.bfloat16,
            low_cpu_mem_usage=False,
        )
        new_pipe.to("cuda")

        with _MODEL_LOCK:
            _pipe = new_pipe
            new_pipe = None
            _MODEL_STATE.update(
                status="loaded",
                current_model=model_id,
                current_model_path=model_path,
                message=f"模型 {model['label']} 已加载。",
                is_busy=False,
                updated_at=time.time(),
            )
            return dict(_MODEL_STATE)
    except Exception as error:
        if new_pipe is not None:
            del new_pipe
            new_pipe = None
            _release_cuda_memory()

        if is_switching and old_model_id is not None:
            old_model = AVAILABLE_MODELS.get(old_model_id)
            if old_model is not None:
                try:
                    with _MODEL_LOCK:
                        _MODEL_STATE.update(
                            status="recovering",
                            message="模型切换失败，正在重新加载旧模型…",
                            is_busy=True,
                            updated_at=time.time(),
                        )

                    restored_pipeline_class = _get_pipeline_class(old_model)
                    restored_pipe = restored_pipeline_class.from_pretrained(
                        old_model["path"],
                        torch_dtype=torch.bfloat16,
                        low_cpu_mem_usage=False,
                    )
                    restored_pipe.to("cuda")

                    with _MODEL_LOCK:
                        _pipe = restored_pipe
                        restored_pipe = None
                        _MODEL_STATE.update(
                            status="loaded",
                            current_model=old_model_id,
                            current_model_path=old_model_path or old_model["path"],
                            message=f"已重新加载旧模型，切换失败：{error}",
                            is_busy=False,
                            updated_at=time.time(),
                        )
                except Exception as restore_error:
                    if restored_pipe is not None:
                        del restored_pipe
                        restored_pipe = None
                        _release_cuda_memory()
                    with _MODEL_LOCK:
                        _pipe = None
                        _MODEL_STATE.update(
                            status="error",
                            current_model=None,
                            current_model_path=None,
                            message=(
                                f"模型切换失败，重新加载旧模型也失败：{error}；"
                                f"恢复错误：{restore_error}"
                            ),
                            is_busy=False,
                            updated_at=time.time(),
                        )
                raise

        with _MODEL_LOCK:
            _pipe = None
            _MODEL_STATE.update(
                status="error",
                current_model=None,
                current_model_path=None,
                message=f"模型加载失败：{error}",
                is_busy=False,
                updated_at=time.time(),
            )
        raise
    finally:
        if old_pipe is not None:
            del old_pipe
            _release_cuda_memory()
        if new_pipe is not None:
            del new_pipe
            _release_cuda_memory()
        if restored_pipe is not None:
            del restored_pipe
            _release_cuda_memory()
        _MODEL_OPERATION_LOCK.release()

def unload_model() -> dict[str, object | None]:
    global _pipe

    if GENERATION_LOCK.locked():
        raise ModelOperationBusy("生成任务正在运行，请停止或等待完成后再卸载模型。")
    if not _MODEL_OPERATION_LOCK.acquire(blocking=False):
        raise ModelOperationBusy("已有模型操作正在进行，请稍候。")

    old_pipe: Any | None = None
    try:
        with _MODEL_LOCK:
            if _pipe is None:
                _MODEL_STATE.update(
                    status="unloaded",
                    current_model=None,
                    current_model_path=None,
                    message="模型已卸载。",
                    is_busy=False,
                    updated_at=time.time(),
                )
                return dict(_MODEL_STATE)

            old_pipe = _pipe
            _pipe = None
            _MODEL_STATE.update(
                status="unloading",
                message="正在卸载模型并释放显存…",
                is_busy=True,
                updated_at=time.time(),
            )

        del old_pipe
        _release_cuda_memory()
        with _MODEL_LOCK:
            _MODEL_STATE.update(
                status="unloaded",
                current_model=None,
                current_model_path=None,
                message="模型已卸载。",
                is_busy=False,
                updated_at=time.time(),
            )
            return dict(_MODEL_STATE)
    except Exception as error:
        with _MODEL_LOCK:
            _MODEL_STATE.update(
                status="error",
                message=f"模型卸载失败：{error}",
                is_busy=False,
                updated_at=time.time(),
            )
        raise
    finally:
        _MODEL_OPERATION_LOCK.release()


def generate_image_from_z(
    prompt: str,
    ratio: str,
    steps: int,
    guidance_scale: float,
    seed: int,
) -> Image.Image | None:
    if ratio not in ASPECT_RATIOS:
        raise ValueError(f"Unsupported ratio: {ratio}")

    current_pipe = get_loaded_pipeline_or_raise()
    total_steps = max(int(steps), 1)
    normalized_seed = int(seed)
    normalized_guidance = float(guidance_scale)

    _STOP_EVENT.clear()
    _update_progress(
        status="preparing",
        message="正在准备模型输入…",
        progress=2,
        current_step=0,
        total_steps=total_steps,
        is_generating=True,
        ratio=ratio,
        seed=normalized_seed,
    )

    width, height = ASPECT_RATIOS[ratio]
    generator = torch.Generator("cuda").manual_seed(normalized_seed)

    def _stop_callback(_pipe, step: int, timestep: int, callback_kwargs: dict):
        completed_steps = min(step + 1, total_steps)
        progress = min(96, max(6, round(completed_steps / total_steps * 96)))

        if _STOP_EVENT.is_set():
            _update_progress(
                status="stopping",
                message=f"正在停止，已完成 {completed_steps}/{total_steps} 步…",
                progress=progress,
                current_step=completed_steps,
                total_steps=total_steps,
                is_generating=True,
            )
            raise GenerationStopped(
                f"Generation stopped at step={step}, timestep={timestep}"
            )

        _update_progress(
            status="generating",
            message=f"正在采样第 {completed_steps}/{total_steps} 步…",
            progress=progress,
            current_step=completed_steps,
            total_steps=total_steps,
            is_generating=True,
        )
        return callback_kwargs

    try:
        result = current_pipe(
            prompt=prompt,
            negative_prompt=NEGATIVE_PROMPT,
            height=height,
            width=width,
            num_inference_steps=total_steps,
            guidance_scale=normalized_guidance,
            generator=generator,
            callback_on_step_end=_stop_callback,
        )
        images = getattr(result, "images", None)
        if not images:
            raise RuntimeError("模型未返回任何图像，请检查模型与输入参数。")
        image = images[0]
        _update_progress(
            status="completed",
            message="生成完成。",
            progress=100,
            current_step=total_steps,
            total_steps=total_steps,
            is_generating=False,
        )
        return image
    except GenerationStopped:
        snapshot = get_progress_snapshot()
        _update_progress(
            status="stopped",
            message="已停止当前生成。",
            progress=snapshot["progress"],
            current_step=snapshot["current_step"],
            total_steps=total_steps,
            is_generating=False,
        )
        return None
    except Exception:
        _update_progress(
            status="error",
            message="生成失败，请检查后端日志。",
            is_generating=False,
        )
        raise
    finally:
        _STOP_EVENT.clear()
