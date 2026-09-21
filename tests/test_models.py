from io import BytesIO
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

from backend import service
from backend.api import app


class ModelIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.state_patch = patch.dict(service._MODEL_STATE, {
            "status": "loaded", "current_model": "Qwen-Image-2.1",
        })
        self.state_patch.start()
        self.addCleanup(self.state_patch.stop)
        self.progress_patch = patch.dict(service._PROGRESS_STATE)
        self.progress_patch.start()
        self.addCleanup(self.progress_patch.stop)
        self.generator_patch = patch.object(service.torch, "Generator")
        self.generator_patch.start()
        self.addCleanup(self.generator_patch.stop)
        self.addCleanup(service._STOP_EVENT.clear)

    def payload(self, **changes):
        return {
            "prompt": "透明背景的小狐狸", "ratio": "1:1", "steps": 40,
            "guidance_scale": 1.0, "seed": 42, **changes,
        }

    def test_model_list_and_model_specific_config(self):
        models = self.client.get("/api/models").json()
        self.assertIn("Qwen-Image-2.1", [m["id"] for m in models["available_models"]])
        config = self.client.get("/api/config").json()
        self.assertEqual(config["model_id"], "Qwen-Image-2.1")
        self.assertEqual(config["defaults"]["steps"], 40)
        self.assertEqual(len(config["aspect_ratios"]), 7)
        for model_id in ("Z-Image-Turbo", "ERNIE-Image"):
            original = self.client.get("/api/config", params={"model_id": model_id}).json()
            self.assertEqual(original["defaults"]["steps"], 8)
            self.assertEqual(original["limits"]["steps"]["max"], 20)
            self.assertEqual(original["aspect_ratios"][0]["width"], 1024)
        self.assertEqual(self.client.get("/api/config?model_id=missing").status_code, 422)

    def test_qwen_parameters_progress_and_png_alpha(self):
        calls = []

        # 严格签名用于发现误传 guidance_scale 等不兼容参数。
        def pipeline(*, prompt, negative_prompt, height, width, num_inference_steps,
                     true_cfg_scale, generator, callback_on_step_end):
            calls.append((width, height, num_inference_steps, true_cfg_scale))
            self.assertEqual(negative_prompt, service.NEGATIVE_PROMPT)
            callback_on_step_end(None, num_inference_steps - 1, 0, {})
            return SimpleNamespace(images=[Image.new("RGBA", (2, 2), (255, 0, 0, 64))])

        with patch.object(service, "_pipe", pipeline):
            for ratio, dimensions in service.AVAILABLE_MODELS["Qwen-Image-2.1"]["aspect_ratios"].items():
                response = self.client.post("/api/generate", json=self.payload(ratio=ratio))
                self.assertEqual(response.status_code, 200, response.text if response.status_code != 200 else "")
                self.assertEqual(calls[-1], (*dimensions, 40, 1.0))
                image = Image.open(BytesIO(response.content))
                self.assertEqual(image.mode, "RGBA")
                self.assertEqual(image.getpixel((0, 0))[3], 64)
        self.assertEqual(service.get_progress_snapshot()["current_step"], 40)
        self.assertEqual(service.get_progress_snapshot()["status"], "completed")

    def test_existing_pipeline_keeps_guidance_scale_and_dimensions(self):
        def pipeline(*, prompt, negative_prompt, height, width, num_inference_steps,
                     guidance_scale, generator, callback_on_step_end):
            self.assertEqual((width, height, num_inference_steps, guidance_scale), (1344, 768, 8, 1.0))
            return SimpleNamespace(images=[Image.new("RGB", (2, 2))])

        for model_id in ("Z-Image-Turbo", "ERNIE-Image"):
            service._MODEL_STATE["current_model"] = model_id
            with patch.object(service, "_pipe", pipeline):
                response = self.client.post("/api/generate", json=self.payload(ratio="16:9", steps=8))
                self.assertEqual(response.status_code, 200)
                for changes in ({"steps": 40}, {"ratio": "3:2", "steps": 8}):
                    self.assertEqual(self.client.post("/api/generate", json=self.payload(**changes)).status_code, 422)

    def test_invalid_qwen_parameters(self):
        with patch.object(service, "_pipe", object()):
            for changes in ({"ratio": "5:1"}, {"steps": 51}, {"steps": 3}):
                self.assertEqual(self.client.post("/api/generate", json=self.payload(**changes)).status_code, 422)

    def test_stop_returns_no_image_and_releases_generation_lock(self):
        def pipeline(**kwargs):
            service.request_stop()
            kwargs["callback_on_step_end"](None, 0, 0, {})
            self.fail("停止请求应中断 Pipeline")

        with patch.object(service, "_pipe", pipeline):
            response = self.client.post("/api/generate", json=self.payload())
        self.assertEqual(response.status_code, 204)
        self.assertEqual(service.get_progress_snapshot()["status"], "stopped")
        self.assertFalse(service.GENERATION_LOCK.locked())

    def test_missing_pipeline_explains_dependency_requirement(self):
        with patch.object(service, "import_module", return_value=SimpleNamespace()):
            with self.assertRaisesRegex(RuntimeError, "transformers>=5.17"):
                service._get_pipeline_class(service.AVAILABLE_MODELS["Qwen-Image-2.1"])


if __name__ == "__main__":
    unittest.main()
