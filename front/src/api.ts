import type {
  AppConfig,
  GeneratePayload,
  ModelLoadPayload,
  ModelState,
  ModelsResponse,
  ProgressSnapshot,
  StopResponse,
} from "./types";

const DEFAULT_TIMEOUT_MS = 15000;
const MODEL_OP_TIMEOUT_MS = 120000;

async function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("请求超时，请检查后端是否正常运行。");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

async function throwResponseError(response: Response): Promise<never> {
  let message = `请求失败（${response.status}）`;

  try {
    const payload = (await response.json()) as { detail?: string; message?: string };
    if (typeof payload.detail === "string") {
      message = payload.detail;
    } else if (typeof payload.message === "string") {
      message = payload.message;
    }
  } catch {
    // Ignore JSON parsing failures and keep the default message.
  }

  throw new Error(message);
}

export async function fetchConfig(modelId: string): Promise<AppConfig> {
  const response = await fetchWithTimeout(`/api/config?model_id=${encodeURIComponent(modelId)}`);
  if (!response.ok) {
    await throwResponseError(response);
  }
  return (await response.json()) as AppConfig;
}

export async function fetchModels(): Promise<ModelsResponse> {
  const response = await fetchWithTimeout("/api/models", {
    cache: "no-store",
  });
  if (!response.ok) {
    await throwResponseError(response);
  }
  return (await response.json()) as ModelsResponse;
}

export async function loadModel(
  payload: ModelLoadPayload,
): Promise<ModelState> {
  const response = await fetchWithTimeout(
    "/api/models/load",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    MODEL_OP_TIMEOUT_MS,
  );
  if (!response.ok) {
    await throwResponseError(response);
  }
  return (await response.json()) as ModelState;
}

export async function unloadModel(): Promise<ModelState> {
  const response = await fetchWithTimeout(
    "/api/models/unload",
    {
      method: "POST",
    },
    MODEL_OP_TIMEOUT_MS,
  );
  if (!response.ok) {
    await throwResponseError(response);
  }
  return (await response.json()) as ModelState;
}

export async function generateImage(
  payload: GeneratePayload,
): Promise<Blob | null> {
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (response.status === 204) {
    return null;
  }
  if (!response.ok) {
    await throwResponseError(response);
  }

  return await response.blob();
}

export async function stopGeneration(): Promise<StopResponse> {
  const response = await fetchWithTimeout("/api/stop", {
    method: "POST",
  });
  if (!response.ok) {
    await throwResponseError(response);
  }
  return (await response.json()) as StopResponse;
}

export async function fetchProgress(): Promise<ProgressSnapshot> {
  const response = await fetchWithTimeout("/api/progress", {
    cache: "no-store",
  });
  if (!response.ok) {
    await throwResponseError(response);
  }
  return (await response.json()) as ProgressSnapshot;
}
