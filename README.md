# Z-Image Studio

Z-Image Studio 是一个本地运行的 AI 图像生成工作台，包含 FastAPI 后端和 Vite/TypeScript 前端。后端负责加载 Diffusers 模型、执行单任务图像生成、提供进度与模型管理接口；前端提供中文创作界面、模型加载/卸载、生成进度、停止任务、下载结果和全屏预览等能力。

## 功能特性

- 本地图像生成：基于 Diffusers Pipeline。
- 多模型选择：支持在后端为不同模型配置不同的 Pipeline 类和本地模型路径。
- 单任务生成：同一时间只运行一个生成任务，避免显存和状态冲突。
- 生成进度：前端轮询后端进度，展示阶段、百分比和采样步数。
- 可停止生成：生成过程中可请求停止当前任务。
- 结果操作：支持下载生成图片和全屏查看。
- 独立前端：Vite 开发服务器代理后端 API，也可构建后由 FastAPI 静态托管。

## 项目结构

```text
.
├── backend/
│   ├── api.py          # FastAPI 路由、请求校验、静态前端托管
│   ├── service.py      # 模型配置、模型生命周期、生成逻辑、进度状态
│   └── __init__.py
├── front/
│   ├── src/
│   │   ├── api.ts      # 前端 API 封装
│   │   ├── main.ts     # 单页应用 UI、状态和交互逻辑
│   │   ├── styles.css  # 页面样式
│   │   └── types.ts    # 前后端数据类型
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── zimage-codex.py     # 后端启动入口
├── CLAUDE.md
└── README.md
```

## 环境要求

### 后端

- Python 3.12 或兼容版本
- CUDA 可用的 NVIDIA GPU
- PyTorch
- Diffusers
- FastAPI
- Uvicorn
- Pillow

当前仓库尚未提供 Python 依赖清单，请根据本地环境安装相关依赖。

### 前端

- Node.js
- npm

## 模型配置

模型配置位于 `backend/service.py` 的 `AVAILABLE_MODELS`：

```python
AVAILABLE_MODELS = {
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
    "Qwen-Image-2.1": {
        "label": "Qwen-Image-2.1",
        "path": "D:/Dev/Model/aigc/Qwen-Image-2.1",
        "pipeline_module": "diffusers",
        "pipeline_class": "QwenImage21Pipeline",
        # 完整配置还包含模型专属步数、画幅和引导参数，见 backend/service.py。
    },
}
```

使用前请确认这些路径在本机存在，并且模型格式可被对应的 Pipeline `from_pretrained()` 加载。

### Qwen-Image-2.1

接入依据：[官方模型页面](https://huggingface.co/Qwen/Qwen-Image-2.1)、[Diffusers 调用说明](https://huggingface.co/docs/diffusers/main/api/pipelines/qwenimage21)。

- 使用 `QwenImage21Pipeline`，加载本地 `D:/Dev/Model/aigc/Qwen-Image-2.1`，保持 BF16 / CUDA 推理。
- 加载模型后，界面自动切换为默认 40 步（可选 4–50 步），引导系数默认 1.0。后端将引导系数映射到 `true_cfg_scale`；大于 1 时结合现有负面提示词开启 CFG。
- 提供官方七种 2K 画幅：1:1（2048×2048）、4:3（2400×1792）、3:4（1792×2400）、3:2（2528×1696）、2:3（1696×2528）、16:9（2752×1536）、9:16（1536×2752）。原有模型继续使用原来的画幅与步数范围。
- 当前工作台接入文生图；可在提示词中描述 RGBA 透明背景，结果以 PNG 保存并保留 alpha 通道。参考图编辑尚无上传入口。

官方要求 PyTorch >= 2.4.0、Transformers >= 5.17、支持该 Pipeline 的 Diffusers 源码版，以及 Accelerate / Pillow。请在 `D:/Dev/program/` 下的后端 Python 环境中更新依赖（不要安装到系统盘）；例如现有 `gpt` 环境可执行：

```powershell
$env:TEMP = "D:/Dev/program/pip-tmp"
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
& D:/Dev/program/miniconda3/envs/gpt/python.exe -m pip install --cache-dir D:/Dev/program/pip-cache -U "transformers>=5.17" accelerate pillow "git+https://github.com/huggingface/diffusers"
```

保留环境中已有且符合要求的 CUDA 版 PyTorch。更新完成后重启后端，再选择并启动 Qwen-Image-2.1。

## 安装与运行

### 1. 安装前端依赖

```bash
cd front
npm install
```

### 2. 启动后端

在项目根目录运行：

```bash
python zimage-codex.py
```

后端默认监听：

```text
http://127.0.0.1:7860
```

启动时不会自动加载模型；请在前端模型管理区域手动启动需要的模型。

### 3. 启动前端开发服务器

在 `front/` 目录运行：

```bash
npm run dev
```

前端默认监听：

```text
http://127.0.0.1:5173
```

Vite 会将 `/api` 请求代理到后端 `http://127.0.0.1:7860`。

## 构建前端

在 `front/` 目录运行：

```bash
npm run build
```

构建产物会输出到：

```text
front/dist/
```

当 `front/dist/` 存在时，FastAPI 后端会自动挂载该目录并提供前端页面。

如需本地预览构建结果：

```bash
npm run preview
```

## API 概览

后端主要接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查与模型状态 |
| `GET` | `/api/config` | 获取当前模型配置；可用 `model_id` 查询指定模型的画幅、默认参数和范围 |
| `GET` | `/api/models` | 获取可用模型与当前模型状态 |
| `POST` | `/api/models/load` | 加载或切换模型 |
| `POST` | `/api/models/unload` | 卸载当前模型并释放显存 |
| `GET` | `/api/progress` | 获取当前生成进度 |
| `POST` | `/api/generate` | 提交图像生成任务，返回 PNG 图片 |
| `POST` | `/api/stop` | 请求停止当前生成任务 |

## 开发说明

- 后端生成逻辑集中在 `backend/service.py`。
- HTTP 请求校验和错误响应集中在 `backend/api.py`。
- 前端没有使用 React/Vue 等框架，主要逻辑集中在 `front/src/main.ts`。
- 前端 API 调用统一封装在 `front/src/api.ts`。
- 类型定义集中在 `front/src/types.ts`，需要与后端响应结构保持一致。
- 后端回归测试：`python -m unittest discover -s tests`，使用替代 Pipeline 验证接口、参数映射及停止行为，无需加载模型权重。
- 当前没有配置 Lint 或 Python 依赖文件。

## 注意事项

- 后端目前强依赖 CUDA：模型会被移动到 `cuda`，随机数生成器也使用 `cuda`。
- 默认模型路径是本地 Windows 绝对路径，换机器运行前通常需要修改。
- 同一时间只允许一个生成任务运行。
- 模型加载、卸载与生成任务互斥，避免显存状态冲突。
- `.env`、缓存、构建产物、依赖目录和 Python 字节码缓存已在 `.gitignore` 中忽略。
