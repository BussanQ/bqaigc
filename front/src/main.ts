import "./styles.css";

import {
  fetchConfig,
  fetchModels,
  fetchProgress,
  generateImage,
  loadModel,
  stopGeneration,
  unloadModel,
} from "./api";
import type {
  AppConfig,
  GeneratePayload,
  ModelState,
  ModelStatus,
  ModelsResponse,
  ProgressSnapshot,
  ProgressStatus,
} from "./types";

interface ViewState {
  config: AppConfig | null;
  models: ModelsResponse | null;
  modelState: ModelState;
  currentImageUrl: string | null;
  isGenerating: boolean;
  isStopping: boolean;
  isModelBusy: boolean;
  progress: ProgressSnapshot;
}

interface SavedParameters {
  prompt: string;
  ratio: string;
  steps: number;
  guidanceScale: number;
  seed: number;
}

const PARAMETERS_STORAGE_KEY = "zimage-studio.parameters.v1";

const DEFAULT_PROGRESS: ProgressSnapshot = {
  status: "idle",
  message: "准备就绪，可开始生成。",
  progress: 0,
  current_step: 0,
  total_steps: 0,
  is_generating: false,
  ratio: null,
  seed: null,
  updated_at: null,
};

const DEFAULT_MODEL_STATE: ModelState = {
  status: "unloaded",
  current_model: null,
  current_model_path: null,
  message: "正在同步模型状态…",
  is_busy: false,
  updated_at: null,
};

const STATUS_META: Record<
  ProgressStatus,
  { title: string; badge: string; loadingTitle: string }
> = {
  idle: {
    title: "待机中",
    badge: "空闲",
    loadingTitle: "等待任务",
  },
  preparing: {
    title: "准备中",
    badge: "准备",
    loadingTitle: "正在准备图像生成…",
  },
  generating: {
    title: "生成中",
    badge: "采样",
    loadingTitle: "正在生成图像…",
  },
  stopping: {
    title: "停止中",
    badge: "停止",
    loadingTitle: "正在停止当前生成…",
  },
  completed: {
    title: "已完成",
    badge: "完成",
    loadingTitle: "生成完成",
  },
  stopped: {
    title: "已停止",
    badge: "已停",
    loadingTitle: "任务已停止",
  },
  error: {
    title: "异常",
    badge: "错误",
    loadingTitle: "生成失败",
  },
};

const MODEL_STATUS_META: Record<
  ModelStatus,
  { title: string; badge: string; action: string }
> = {
  unloaded: {
    title: "未加载模型",
    badge: "未加载",
    action: "启动模型",
  },
  loading: {
    title: "模型加载中",
    badge: "加载中",
    action: "加载中…",
  },
  loaded: {
    title: "模型已加载",
    badge: "已加载",
    action: "重新加载",
  },
  unloading: {
    title: "模型卸载中",
    badge: "卸载中",
    action: "请稍候…",
  },
  switching: {
    title: "模型切换中",
    badge: "切换中",
    action: "切换中…",
  },
  error: {
    title: "模型异常",
    badge: "异常",
    action: "重试加载",
  },
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("App root was not found.");
}
const root = app;

root.innerHTML = `
  <main class="page-shell">
    <header class="hero-banner">
      <div class="hero-copy">
        <span class="hero-eyebrow">Z-Image Studio</span>
        <h1>独立前端工作台</h1>
        <p>保留当前 Python 生图后端能力，同时补上更细的忙碌态、真实步数进度和更顺滑的创作反馈。</p>
      </div>
      <div class="hero-card">
        <span class="hero-card-label">Render mode</span>
        <strong>Single-job generation</strong>
        <p>单任务生成、可随时停止，并保留下载与全屏查看能力。</p>
      </div>
    </header>

    <div class="app-shell">
      <section class="panel control-panel">
        <div class="panel-head">
          <span class="panel-kicker">Controls</span>
          <h3>创作参数</h3>
          <p>建议从主体、场景、镜头、光线和材质入手组织提示词，再用步数和引导系数做细调。</p>
        </div>

        <section class="model-card" aria-live="polite">
          <div class="model-card-head">
            <div>
              <span class="activity-kicker">Model manager</span>
              <strong id="model-title">未加载模型</strong>
            </div>
            <span id="model-badge" class="activity-badge" data-status="unloaded">未加载</span>
          </div>

          <label class="field model-field" for="model-select">
            <span class="field-label">当前模型</span>
            <select id="model-select" disabled></select>
          </label>

          <div class="model-meta">
            <span id="model-message">正在同步模型状态…</span>
            <span id="model-path" class="model-path">-</span>
          </div>

          <div class="action-row model-action-row">
            <button id="load-model-btn" class="btn btn-secondary" type="button" disabled>启动模型</button>
            <button id="unload-model-btn" class="btn btn-stop" type="button" disabled>卸载模型</button>
          </div>
        </section>

        <label class="field field-prompt" for="prompt-input">
          <span class="field-label-row">
            <span class="field-label">提示词</span>
            <span id="prompt-count" class="field-count">0 / 2000</span>
          </span>
          <textarea id="prompt-input" rows="4" maxlength="2000"></textarea>
        </label>

        <div class="helper-note"><strong>Prompt 结构：</strong>主体 + 场景 + 光线 + 镜头语言 + 材质 + 风格关键词，通常比只堆风格词更稳定。</div>

        <div class="field-grid">
          <label class="field" for="ratio-input">
            <span class="field-label">宽高比</span>
            <select id="ratio-input" disabled></select>
            <span id="ratio-presets" class="ratio-presets" aria-label="常用宽高比"></span>
          </label>

          <label class="field" for="steps-input">
            <span class="field-label">采样步数</span>
            <div class="slider-field">
              <input id="steps-input" type="range" disabled />
              <span id="steps-value" class="slider-value">-</span>
            </div>
          </label>
        </div>

        <div class="field-grid field-grid-wide">
          <label class="field" for="guidance-input">
            <span class="field-label">引导系数</span>
            <div class="slider-field">
              <input id="guidance-input" type="range" disabled />
              <span id="guidance-value" class="slider-value">-</span>
            </div>
          </label>

          <label class="field" for="seed-input">
            <span class="field-label">随机种子</span>
            <div class="seed-row">
              <input id="seed-input" type="number" disabled />
              <button id="seed-btn" class="btn btn-secondary" type="button" disabled>随机</button>
            </div>
          </label>
        </div>

        <div class="action-row action-row-primary">
          <button id="generate-btn" class="btn btn-primary" type="button" disabled>生成图像</button>
          <button id="stop-btn" class="btn btn-stop" type="button" disabled>停止</button>
          <button id="reset-btn" class="btn btn-secondary" type="button" disabled>恢复默认</button>
        </div>

        <section class="activity-card" aria-live="polite">
          <div class="activity-head">
            <div>
              <span class="activity-kicker">Render status</span>
              <strong id="activity-title">待机中</strong>
            </div>
            <span id="activity-badge" class="activity-badge" data-status="idle">空闲</span>
          </div>

          <div class="activity-progress-row">
            <div id="activity-progress" class="progress-track" role="progressbar" aria-label="生成进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
              <div id="progress-fill" class="progress-fill"></div>
            </div>
            <span id="progress-percent" class="progress-percent">0%</span>
          </div>

          <div class="activity-meta">
            <span id="progress-message">准备就绪，可开始生成。</span>
            <span id="progress-step">等待下一次任务</span>
          </div>
        </section>

        <div class="helper-note"><strong>迭代建议：</strong>先固定随机种子，再微调提示词和引导系数，能更直接看出每一步到底改变了什么。</div>
      </section>

      <section class="panel result-panel">
        <div class="panel-head">
          <span class="panel-kicker">Canvas</span>
          <h3>生成结果</h3>
          <p>结果区域保留下载和全屏工具，生成过程中会显示更细的阶段、百分比和采样步数。</p>
        </div>

        <div class="result-shell">
          <div class="result-toolbar">
            <button id="download-btn" class="toolbar-btn" type="button" disabled>下载</button>
            <button id="fullscreen-btn" class="toolbar-btn" type="button" disabled>全屏</button>
          </div>

          <div id="result-stage" class="result-stage" data-status="idle">
            <div id="result-empty" class="result-empty">生成结果会显示在这里</div>
            <div id="result-loading" class="result-loading" hidden>
              <div class="loading-card">
                <span id="loading-eyebrow" class="loading-eyebrow">准备中</span>
                <strong id="loading-title" class="loading-title">正在生成图像…</strong>
                <p id="loading-message" class="loading-message">正在准备模型输入…</p>
                <div class="loading-progress-row">
                  <span id="loading-percent" class="loading-percent">0%</span>
                  <div id="loading-progress" class="progress-track progress-track-strong" role="progressbar" aria-label="当前生成进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                    <div id="loading-progress-fill" class="progress-fill"></div>
                  </div>
                </div>
                <span id="loading-step" class="loading-step">等待当前任务开始</span>
              </div>
            </div>
            <img id="result-image" class="result-image" alt="生成结果" hidden />
          </div>
        </div>

        <div id="status-note" class="status-note" data-state="idle">正在加载配置…</div>

        <div class="helper-note"><strong>提示：</strong>如果想做稳定对比，先保持同一个 seed，只改一个变量，再观察构图、质感和细节密度的变化。</div>
      </section>
    </div>
  </main>
`;

function getElement<T extends Element>(selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }
  return element;
}

const modelTitle = getElement<HTMLElement>("#model-title");
const modelBadge = getElement<HTMLElement>("#model-badge");
const modelSelect = getElement<HTMLSelectElement>("#model-select");
const modelMessage = getElement<HTMLSpanElement>("#model-message");
const modelPath = getElement<HTMLSpanElement>("#model-path");
const loadModelButton = getElement<HTMLButtonElement>("#load-model-btn");
const unloadModelButton = getElement<HTMLButtonElement>("#unload-model-btn");
const promptInput = getElement<HTMLTextAreaElement>("#prompt-input");
const promptCount = getElement<HTMLSpanElement>("#prompt-count");
const ratioInput = getElement<HTMLSelectElement>("#ratio-input");
const ratioPresets = getElement<HTMLSpanElement>("#ratio-presets");
const stepsInput = getElement<HTMLInputElement>("#steps-input");
const stepsValue = getElement<HTMLSpanElement>("#steps-value");
const guidanceInput = getElement<HTMLInputElement>("#guidance-input");
const guidanceValue = getElement<HTMLSpanElement>("#guidance-value");
const seedInput = getElement<HTMLInputElement>("#seed-input");
const seedButton = getElement<HTMLButtonElement>("#seed-btn");
const generateButton = getElement<HTMLButtonElement>("#generate-btn");
const stopButton = getElement<HTMLButtonElement>("#stop-btn");
const resetButton = getElement<HTMLButtonElement>("#reset-btn");
const downloadButton = getElement<HTMLButtonElement>("#download-btn");
const fullscreenButton = getElement<HTMLButtonElement>("#fullscreen-btn");
const resultStage = getElement<HTMLDivElement>("#result-stage");
const resultEmpty = getElement<HTMLDivElement>("#result-empty");
const resultLoading = getElement<HTMLDivElement>("#result-loading");
const resultImage = getElement<HTMLImageElement>("#result-image");
const statusNote = getElement<HTMLDivElement>("#status-note");
const activityTitle = getElement<HTMLElement>("#activity-title");
const activityBadge = getElement<HTMLElement>("#activity-badge");
const progressFill = getElement<HTMLDivElement>("#progress-fill");
const activityProgress = getElement<HTMLDivElement>("#activity-progress");
const progressPercent = getElement<HTMLSpanElement>("#progress-percent");
const progressMessage = getElement<HTMLSpanElement>("#progress-message");
const progressStep = getElement<HTMLSpanElement>("#progress-step");
const loadingEyebrow = getElement<HTMLSpanElement>("#loading-eyebrow");
const loadingTitle = getElement<HTMLElement>("#loading-title");
const loadingMessage = getElement<HTMLParagraphElement>("#loading-message");
const loadingPercent = getElement<HTMLSpanElement>("#loading-percent");
const loadingProgressFill = getElement<HTMLDivElement>("#loading-progress-fill");
const loadingProgress = getElement<HTMLDivElement>("#loading-progress");
const loadingStep = getElement<HTMLSpanElement>("#loading-step");

const state: ViewState = {
  config: null,
  models: null,
  modelState: { ...DEFAULT_MODEL_STATE },
  currentImageUrl: null,
  isGenerating: false,
  isStopping: false,
  isModelBusy: false,
  progress: { ...DEFAULT_PROGRESS },
};

let progressPollingTimer: number | null = null;
let isSyncingProgress = false;

const PROGRESS_POLL_INTERVAL_MS = 700;
let lastProgressSignature: string | null = null;
let lastModelSignature: string | null = null;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function randomInRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function revokeCurrentImageUrl(): void {
  if (!state.currentImageUrl) {
    return;
  }
  URL.revokeObjectURL(state.currentImageUrl);
  state.currentImageUrl = null;
}

function setStatus(
  message: string,
  type: "idle" | "loading" | "success" | "error" = "idle",
): void {
  statusNote.textContent = message;
  statusNote.dataset.state = type;
}

function syncSliderValues(): void {
  stepsValue.textContent = stepsInput.value;
  guidanceValue.textContent = Number(guidanceInput.value).toFixed(1);
}

function updatePromptCount(): void {
  promptCount.textContent = `${promptInput.value.length} / ${promptInput.maxLength}`;
}

function saveParameters(): void {
  if (!state.config) {
    return;
  }
  const parameters: SavedParameters = {
    prompt: promptInput.value,
    ratio: ratioInput.value,
    steps: Number(stepsInput.value),
    guidanceScale: Number(guidanceInput.value),
    seed: Number(seedInput.value),
  };
  localStorage.setItem(PARAMETERS_STORAGE_KEY, JSON.stringify(parameters));
}

function restoreParameters(): void {
  if (!state.config) {
    return;
  }
  try {
    const raw = localStorage.getItem(PARAMETERS_STORAGE_KEY);
    if (!raw) {
      return;
    }
    const saved = JSON.parse(raw) as Partial<SavedParameters>;
    promptInput.value = typeof saved.prompt === "string" ? saved.prompt : "";
    if (state.config.aspect_ratios.some((option) => option.label === saved.ratio)) {
      ratioInput.value = saved.ratio ?? state.config.defaults.ratio;
    }
    if (Number.isFinite(saved.steps)) {
      stepsInput.value = String(clampNumber(Number(saved.steps), state.config.limits.steps.min, state.config.limits.steps.max));
    }
    if (Number.isFinite(saved.guidanceScale)) {
      guidanceInput.value = String(clampNumber(Number(saved.guidanceScale), state.config.limits.guidance_scale.min, state.config.limits.guidance_scale.max));
    }
    if (Number.isFinite(saved.seed)) {
      setSeedValue(clampNumber(Math.trunc(Number(saved.seed)), state.config.limits.seed.min, state.config.limits.seed.max));
    }
  } catch {
    localStorage.removeItem(PARAMETERS_STORAGE_KEY);
  }
}

function syncRatioPresets(): void {
  for (const button of ratioPresets.querySelectorAll<HTMLButtonElement>("button")) {
    button.dataset.active = String(button.dataset.ratio === ratioInput.value);
  }
}

function resetParameters(): void {
  if (!state.config) {
    return;
  }
  promptInput.value = "";
  ratioInput.value = state.config.defaults.ratio;
  stepsInput.value = String(state.config.defaults.steps);
  guidanceInput.value = String(state.config.defaults.guidance_scale);
  setSeedValue(state.config.defaults.initial_seed);
  localStorage.removeItem(PARAMETERS_STORAGE_KEY);
  syncSliderValues();
  syncRatioPresets();
  updatePromptCount();
  setStatus("创作参数已恢复默认值。", "idle");
}

function isModelOperationActive(): boolean {
  return (
    state.isModelBusy ||
    state.modelState.is_busy ||
    state.modelState.status === "loading" ||
    state.modelState.status === "unloading" ||
    state.modelState.status === "switching"
  );
}

function isModelLoaded(): boolean {
  return state.modelState.status === "loaded";
}

function formatStepText(progress: ProgressSnapshot): string {
  if (progress.total_steps <= 0) {
    return "等待下一次任务";
  }

  const current = Math.min(progress.current_step, progress.total_steps);
  switch (progress.status) {
    case "preparing":
      return `已接收任务，共 ${progress.total_steps} 步`;
    case "completed":
      return `已完成 ${progress.total_steps}/${progress.total_steps} 步`;
    case "stopped":
      return `已在 ${current}/${progress.total_steps} 步停止`;
    case "error":
      return `任务在 ${current}/${progress.total_steps} 步附近中断`;
    default:
      return `采样进度 ${current}/${progress.total_steps} 步`;
  }
}

function renderProgress(): void {
  const progress = state.progress;
  const meta = STATUS_META[progress.status];
  const percent = `${Math.round(clampNumber(progress.progress, 0, 100))}%`;
  const stepText = formatStepText(progress);

  const signature = [
    progress.status,
    percent,
    progress.message,
    stepText,
    state.isGenerating ? "1" : "0",
    state.isStopping ? "1" : "0",
  ].join("|");
  if (signature === lastProgressSignature) {
    return;
  }
  lastProgressSignature = signature;

  activityTitle.textContent = meta.title;
  activityBadge.textContent = meta.badge;
  activityBadge.dataset.status = progress.status;
  progressFill.style.width = percent;
  activityProgress.setAttribute("aria-valuenow", String(Math.round(clampNumber(progress.progress, 0, 100))));
  progressPercent.textContent = percent;
  progressMessage.textContent = progress.message;
  progressStep.textContent = stepText;

  loadingEyebrow.textContent = meta.title;
  loadingTitle.textContent = meta.loadingTitle;
  loadingMessage.textContent = progress.message;
  loadingPercent.textContent = percent;
  loadingProgressFill.style.width = percent;
  loadingProgress.setAttribute("aria-valuenow", String(Math.round(clampNumber(progress.progress, 0, 100))));
  loadingStep.textContent = stepText;

  resultStage.dataset.status = progress.status;
  generateButton.textContent = state.isGenerating
    ? state.isStopping
      ? "停止中…"
      : "生成中…"
    : "生成图像";
  stopButton.textContent = state.isStopping ? "停止中…" : "停止";
}

function renderModelState(): void {
  const modelState = state.modelState;
  const meta = MODEL_STATUS_META[modelState.status];
  const selectedModel = modelSelect.value;
  const selectedDiffers = Boolean(
    selectedModel && modelState.current_model && selectedModel !== modelState.current_model,
  );

  const signature = [
    modelState.status,
    modelState.current_model ?? "",
    modelState.current_model_path ?? "",
    modelState.message,
    selectedModel,
    isModelOperationActive() ? "1" : "0",
  ].join("|");
  if (signature === lastModelSignature) {
    return;
  }
  lastModelSignature = signature;

  modelTitle.textContent = modelState.current_model
    ? `${meta.title} · ${modelState.current_model}`
    : meta.title;
  modelBadge.textContent = meta.badge;
  modelBadge.dataset.status = modelState.status;
  modelMessage.textContent = modelState.message;
  modelPath.textContent = modelState.current_model_path || "未加载模型路径";

  if (isModelOperationActive()) {
    loadModelButton.textContent = meta.action;
  } else if (selectedDiffers) {
    loadModelButton.textContent = "切换模型";
  } else {
    loadModelButton.textContent = meta.action;
  }
}

function populateModelOptions(response: ModelsResponse): void {
  const previousValue = modelSelect.value;
  const nextValue =
    response.state.current_model || previousValue || response.default_model_id;

  modelSelect.innerHTML = "";
  for (const model of response.available_models) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.label;
    modelSelect.append(option);
  }

  if (response.available_models.some((model) => model.id === nextValue)) {
    modelSelect.value = nextValue;
  } else if (response.available_models.length > 0) {
    modelSelect.value = response.available_models[0].id;
  }
}

function updateResultState(): void {
  const hasImage = Boolean(state.currentImageUrl);
  resultImage.hidden = !hasImage;
  resultEmpty.hidden = hasImage || state.isGenerating;
  resultLoading.hidden = !state.isGenerating;
  downloadButton.disabled = !hasImage || state.isGenerating;
  fullscreenButton.disabled = !hasImage || state.isGenerating;
}

function updateActionState(): void {
  const configReady = Boolean(state.config);
  const modelsReady = Boolean(state.models?.available_models.length);
  const modelBusy = isModelOperationActive();
  const modelLoaded = isModelLoaded();
  const generationControlsDisabled =
    !configReady || !modelLoaded || state.isGenerating || modelBusy;

  promptInput.disabled = generationControlsDisabled;
  ratioInput.disabled = generationControlsDisabled;
  for (const button of ratioPresets.querySelectorAll<HTMLButtonElement>("button")) {
    button.disabled = generationControlsDisabled;
  }
  stepsInput.disabled = generationControlsDisabled;
  guidanceInput.disabled = generationControlsDisabled;
  seedInput.disabled = generationControlsDisabled;
  seedButton.disabled = generationControlsDisabled;
  generateButton.disabled = generationControlsDisabled;
  resetButton.disabled = !configReady || state.isGenerating || modelBusy;
  stopButton.disabled = !state.isGenerating || state.isStopping;

  modelSelect.disabled = !modelsReady || state.isGenerating || modelBusy;
  loadModelButton.disabled =
    !modelsReady || !modelSelect.value || state.isGenerating || modelBusy;
  unloadModelButton.disabled = !modelLoaded || state.isGenerating || modelBusy;
}

function setCurrentImage(blob: Blob): void {
  revokeCurrentImageUrl();
  try {
    state.currentImageUrl = URL.createObjectURL(blob);
    resultImage.src = state.currentImageUrl;
  } catch (error) {
    state.currentImageUrl = null;
    setStatus(`图像预览创建失败：${getErrorMessage(error)}`, "error");
  }
  updateResultState();
}

function setSeedValue(seed: number): void {
  seedInput.value = String(Math.trunc(seed));
}

function assignRandomSeed(): void {
  if (!state.config) {
    return;
  }
  const { min, max } = state.config.limits.seed;
  setSeedValue(randomInRange(min, max));
}

function populateRatioOptions(config: AppConfig): void {
  ratioInput.innerHTML = "";

  for (const option of config.aspect_ratios) {
    const element = document.createElement("option");
    element.value = option.label;
    element.textContent = option.label;
    ratioInput.append(element);
  }

  ratioInput.value = config.defaults.ratio;
  ratioPresets.innerHTML = "";
  for (const option of config.aspect_ratios.slice(0, 5)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ratio-preset";
    button.dataset.ratio = option.label;
    button.textContent = option.label;
    button.addEventListener("click", () => {
      ratioInput.value = option.label;
      syncRatioPresets();
      saveParameters();
    });
    ratioPresets.append(button);
  }
  syncRatioPresets();
}

function readPayload(): GeneratePayload {
  if (!state.config) {
    throw new Error("配置尚未加载完成。请稍后重试。");
  }
  if (!isModelLoaded()) {
    throw new Error("请先启动模型，再生成图像。");
  }

  const prompt = promptInput.value.trim();
  if (!prompt) {
    throw new Error("请输入提示词。");
  }

  const steps = clampNumber(
    Math.round(Number(stepsInput.value)),
    state.config.limits.steps.min,
    state.config.limits.steps.max,
  );
  const guidanceScale = clampNumber(
    Number(guidanceInput.value),
    state.config.limits.guidance_scale.min,
    state.config.limits.guidance_scale.max,
  );
  const rawSeed = Math.trunc(Number(seedInput.value));
  if (!Number.isFinite(rawSeed)) {
    throw new Error("请输入有效的随机种子。");
  }
  const seed = clampNumber(
    rawSeed,
    state.config.limits.seed.min,
    state.config.limits.seed.max,
  );

  stepsInput.value = String(steps);
  guidanceInput.value = guidanceScale.toFixed(1);
  seedInput.value = String(seed);
  syncSliderValues();

  return {
    prompt,
    ratio: ratioInput.value,
    steps,
    guidance_scale: Number(guidanceScale.toFixed(1)),
    seed,
  };
}

function downloadCurrentImage(): void {
  if (!state.currentImageUrl) {
    return;
  }

  const timestamp = new Date().toISOString().replace(/[.:]/g, "-");
  const link = document.createElement("a");
  link.href = state.currentImageUrl;
  link.download = `zimage-${timestamp}.png`;
  link.click();
}

function toggleFullscreen(): void {
  if (!state.currentImageUrl) {
    return;
  }

  if (document.fullscreenElement === resultStage) {
    void document.exitFullscreen();
    return;
  }

  const request = resultStage.requestFullscreen?.();
  if (request) {
    request.catch((error: unknown) => {
      setStatus(`无法进入全屏：${getErrorMessage(error)}`, "error");
    });
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.trim();
  }
  return "发生未知错误，请稍后再试。";
}

function createOptimisticProgress(payload: GeneratePayload): ProgressSnapshot {
  return {
    status: "preparing",
    message: "正在提交生成请求…",
    progress: 1,
    current_step: 0,
    total_steps: payload.steps,
    is_generating: true,
    ratio: payload.ratio,
    seed: payload.seed,
    updated_at: Date.now() / 1000,
  };
}

async function syncProgressSnapshot(): Promise<void> {
  if (isSyncingProgress) {
    return;
  }

  isSyncingProgress = true;
  try {
    state.progress = await fetchProgress();
    renderProgress();
  } catch (error) {
    if (state.isGenerating) {
      setStatus(`进度同步失败：${getErrorMessage(error)}`, "error");
    }
  } finally {
    isSyncingProgress = false;
  }
}

async function syncModels(updateStatus = true): Promise<void> {
  try {
    const response = await fetchModels();
    state.models = response;
    state.modelState = response.state;
    populateModelOptions(response);
    renderModelState();

    if (updateStatus && !state.isGenerating && state.config) {
      if (state.modelState.status === "loaded") {
        setStatus("模型已加载，可开始生成。", "idle");
      } else if (state.modelState.status === "error") {
        setStatus(state.modelState.message, "error");
      } else {
        setStatus(state.modelState.message, "loading");
      }
    }
  } catch (error) {
    state.modelState = {
      ...state.modelState,
      status: "error",
      message: `模型状态同步失败：${getErrorMessage(error)}`,
      is_busy: false,
      updated_at: Date.now() / 1000,
    };
    renderModelState();
    if (updateStatus) {
      setStatus(state.modelState.message, "error");
    }
  } finally {
    updateActionState();
  }
}

function startProgressPolling(): void {
  if (progressPollingTimer !== null) {
    return;
  }
  void syncProgressSnapshot();
  progressPollingTimer = window.setInterval(() => {
    void syncProgressSnapshot();
  }, PROGRESS_POLL_INTERVAL_MS);
}

function stopProgressPolling(): void {
  if (progressPollingTimer === null) {
    return;
  }
  window.clearInterval(progressPollingTimer);
  progressPollingTimer = null;
}

async function loadConfig(): Promise<void> {
  try {
    setStatus("正在加载配置…", "loading");
    const config = await fetchConfig();
    state.config = config;

    populateRatioOptions(config);
    promptInput.placeholder = config.defaults.prompt_placeholder;

    stepsInput.min = String(config.limits.steps.min);
    stepsInput.max = String(config.limits.steps.max);
    stepsInput.step = String(config.limits.steps.step);
    stepsInput.value = String(config.defaults.steps);

    guidanceInput.min = String(config.limits.guidance_scale.min);
    guidanceInput.max = String(config.limits.guidance_scale.max);
    guidanceInput.step = String(config.limits.guidance_scale.step);
    guidanceInput.value = String(config.defaults.guidance_scale);

    seedInput.min = String(config.limits.seed.min);
    seedInput.max = String(config.limits.seed.max);
    seedInput.step = String(config.limits.seed.step);
    setSeedValue(config.defaults.initial_seed);

    restoreParameters();

    syncSliderValues();
    syncRatioPresets();
    updatePromptCount();
    setStatus("配置已加载，正在确认模型状态…", "loading");
  } catch (error) {
    setStatus(`加载配置失败：${getErrorMessage(error)}`, "error");
  } finally {
    updateActionState();
    updateResultState();
    renderProgress();
  }
}

async function handleLoadModel(): Promise<void> {
  if (state.isGenerating || isModelOperationActive()) {
    return;
  }

  const modelId = modelSelect.value;
  if (!modelId) {
    setStatus("请选择要启动的模型。", "error");
    return;
  }

  const isSwitching = Boolean(
    state.modelState.current_model && state.modelState.current_model !== modelId,
  );
  state.isModelBusy = true;
  state.modelState = {
    ...state.modelState,
    status: isSwitching ? "switching" : "loading",
    message: isSwitching ? "正在切换模型…" : "正在启动模型…",
    is_busy: true,
    updated_at: Date.now() / 1000,
  };
  renderModelState();
  updateActionState();
  setStatus(state.modelState.message, "loading");

  try {
    state.modelState = await loadModel({ model_id: modelId });
    renderModelState();
    setStatus(state.modelState.message, "success");
  } catch (error) {
    const message = getErrorMessage(error);
    state.modelState = {
      ...state.modelState,
      status: "error",
      message,
      is_busy: false,
      updated_at: Date.now() / 1000,
    };
    renderModelState();
    setStatus(message, "error");
  } finally {
    state.isModelBusy = false;
    await syncModels(false);
    updateActionState();
    renderModelState();
  }
}

async function handleUnloadModel(): Promise<void> {
  if (state.isGenerating || isModelOperationActive()) {
    return;
  }

  state.isModelBusy = true;
  state.modelState = {
    ...state.modelState,
    status: "unloading",
    message: "正在卸载模型并释放显存…",
    is_busy: true,
    updated_at: Date.now() / 1000,
  };
  renderModelState();
  updateActionState();
  setStatus(state.modelState.message, "loading");

  try {
    state.modelState = await unloadModel();
    renderModelState();
    setStatus(state.modelState.message, "idle");
  } catch (error) {
    const message = getErrorMessage(error);
    state.modelState = {
      ...state.modelState,
      status: "error",
      message,
      is_busy: false,
      updated_at: Date.now() / 1000,
    };
    renderModelState();
    setStatus(message, "error");
  } finally {
    state.isModelBusy = false;
    await syncModels(false);
    updateActionState();
    renderModelState();
  }
}

async function handleGenerate(): Promise<void> {
  if (state.isGenerating) {
    return;
  }

  try {
    const payload = readPayload();
    state.isGenerating = true;
    state.isStopping = false;
    state.progress = createOptimisticProgress(payload);
    updateActionState();
    updateResultState();
    renderProgress();
    setStatus("生成任务已提交，正在等待后端开始采样…", "loading");
    startProgressPolling();

    const blob = await generateImage(payload);
    if (blob) {
      setCurrentImage(blob);
    }

    await syncProgressSnapshot();

    if (blob) {
      setStatus("生成完成。", "success");
    } else {
      setStatus("已停止当前生成。", "idle");
    }
  } catch (error) {
    const message = getErrorMessage(error);
    state.progress = {
      ...state.progress,
      status: "error",
      message,
      is_generating: false,
      updated_at: Date.now() / 1000,
    };
    renderProgress();
    setStatus(message, "error");
    await syncModels(false);
  } finally {
    state.isGenerating = false;
    state.isStopping = false;
    stopProgressPolling();
    await syncProgressSnapshot();
    updateActionState();
    updateResultState();
    renderProgress();
  }
}

async function handleStop(): Promise<void> {
  if (!state.isGenerating || state.isStopping) {
    return;
  }

  state.isStopping = true;
  updateActionState();
  renderProgress();
  setStatus("已发出停止指令，等待当前采样步结束…", "loading");

  try {
    await stopGeneration();
    await syncProgressSnapshot();
  } catch (error) {
    state.isStopping = false;
    updateActionState();
    renderProgress();
    setStatus(getErrorMessage(error), "error");
  }
}

async function initializeApp(): Promise<void> {
  renderModelState();
  await Promise.allSettled([loadConfig(), syncModels()]);
  await syncProgressSnapshot();
  updateActionState();
  updateResultState();
  renderProgress();
  renderModelState();
}

modelSelect.addEventListener("change", () => {
  renderModelState();
  updateActionState();
});
loadModelButton.addEventListener("click", () => {
  void handleLoadModel();
});
unloadModelButton.addEventListener("click", () => {
  void handleUnloadModel();
});
stepsInput.addEventListener("input", syncSliderValues);
guidanceInput.addEventListener("input", syncSliderValues);
promptInput.addEventListener("input", () => {
  updatePromptCount();
  saveParameters();
});
ratioInput.addEventListener("change", () => {
  syncRatioPresets();
  saveParameters();
});
for (const input of [stepsInput, guidanceInput, seedInput]) {
  input.addEventListener("change", saveParameters);
}
seedButton.addEventListener("click", () => {
  assignRandomSeed();
  saveParameters();
});
resetButton.addEventListener("click", resetParameters);
generateButton.addEventListener("click", () => {
  void handleGenerate();
});
stopButton.addEventListener("click", () => {
  void handleStop();
});
downloadButton.addEventListener("click", downloadCurrentImage);
fullscreenButton.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", () => {
  fullscreenButton.textContent =
    document.fullscreenElement === resultStage ? "退出全屏" : "全屏";
});
window.addEventListener("beforeunload", () => {
  revokeCurrentImageUrl();
  stopProgressPolling();
});

updateActionState();
updateResultState();
renderProgress();
renderModelState();
void initializeApp();
