export interface RangeConfig {
  min: number;
  max: number;
  step: number;
}

export interface AspectRatioOption {
  label: string;
  width: number;
  height: number;
}

export interface AppConfig {
  model_id: string;
  aspect_ratios: AspectRatioOption[];
  defaults: {
    ratio: string;
    steps: number;
    guidance_scale: number;
    initial_seed: number;
    prompt_placeholder: string;
  };
  limits: {
    steps: RangeConfig;
    guidance_scale: RangeConfig;
    seed: RangeConfig;
  };
}

export interface GeneratePayload {
  prompt: string;
  ratio: string;
  steps: number;
  guidance_scale: number;
  seed: number;
}

export interface StopResponse {
  status: "idle" | "stopping";
}

export type ModelStatus =
  | "unloaded"
  | "loading"
  | "loaded"
  | "unloading"
  | "switching"
  | "recovering"
  | "error";

export interface ModelInfo {
  id: string;
  label: string;
  path: string;
}

export interface ModelState {
  status: ModelStatus;
  current_model: string | null;
  current_model_path: string | null;
  message: string;
  is_busy: boolean;
  updated_at: number | null;
}

export interface ModelsResponse {
  available_models: ModelInfo[];
  default_model_id: string;
  state: ModelState;
}

export interface ModelLoadPayload {
  model_id: string;
}

export type ProgressStatus =
  | "idle"
  | "preparing"
  | "generating"
  | "stopping"
  | "completed"
  | "stopped"
  | "error";

export interface ProgressSnapshot {
  status: ProgressStatus;
  message: string;
  progress: number;
  current_step: number;
  total_steps: number;
  is_generating: boolean;
  ratio: string | null;
  seed: number | null;
  updated_at: number | null;
}
