import type {
  AppConfig,
  GeneratePayload,
  ModelLoadPayload,
  ModelState,
  ModelsResponse,
  ProgressSnapshot,
  StopResponse,
} from "./types";

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

export async function fetchConfig(): Promise<AppConfig> {
  const response = await fetch("/api/config");
  if (!response.ok) {
    await throwResponseError(response);
  }
  return (await response.json()) as AppConfig;
}

export async function fetchModels(): Promise<ModelsResponse> {
  const response = await fetch("/api/models", {
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
  const response = await fetch("/api/models/load", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    await throwResponseError(response);
  }
  return (await response.json()) as ModelState;
}

export async function unloadModel(): Promise<ModelState> {
  const response = await fetch("/api/models/unload", {
    method: "POST",
  });
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
  const response = await fetch("/api/stop", {
    method: "POST",
  });
  if (!response.ok) {
    await throwResponseError(response);
  }
  return (await response.json()) as StopResponse;
}

export async function fetchProgress(): Promise<ProgressSnapshot> {
  const response = await fetch("/api/progress", {
    cache: "no-store",
  });
  if (!response.ok) {
    await throwResponseError(response);
  }
  return (await response.json()) as ProgressSnapshot;
}
