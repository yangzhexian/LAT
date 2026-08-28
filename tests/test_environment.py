import unittest
from unittest.mock import patch

from local_translator.environment import inspect_download_environment


class EnvironmentTests(unittest.TestCase):
    @patch("local_translator.environment.subprocess.run")
    def test_reports_ready_gpu(self, run):
        run.return_value.returncode = 0
        run.return_value.stdout = "NVIDIA GeForce RTX 5070, 12288\n"

        result = inspect_download_environment()

        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["best_gpu"]["name"], "NVIDIA GeForce RTX 5070")
        self.assertEqual(result["best_gpu"]["total_vram_gib"], 12.0)
        self.assertNotIn("free_vram_gib", result["best_gpu"])

    @patch("local_translator.environment.subprocess.run")
    def test_warns_when_gpu_is_too_small(self, run):
        run.return_value.returncode = 0
        run.return_value.stdout = "NVIDIA GPU, 6144\n"

        result = inspect_download_environment()

        self.assertEqual(result["status"], "insufficient")
        self.assertIn("1.8B", result["suggestion"])



    @patch("local_translator.environment.subprocess.run")
    def test_recommends_highest_quality_variant_that_fits_total_vram(self, run):
        run.return_value.returncode = 0
        run.return_value.stdout = "NVIDIA GeForce RTX 5070, 12288\n"

        result = inspect_download_environment()

        self.assertEqual(result["recommended_model"], "hy-mt2-7b:q6_k")
        self.assertEqual(result["model"], "hy-mt2-7b:q6_k")
        self.assertTrue(any(option["recommended"] for option in result["models"]))
        self.assertNotIn("报告", result["suggestion"])
        self.assertTrue(all("benchmark" not in option for option in result["models"]))
        self.assertNotIn("free_vram_gib", result["best_gpu"])

    @patch("local_translator.environment.subprocess.run")
    def test_model_selection_is_checked_against_total_vram(self, run):
        run.return_value.returncode = 0
        run.return_value.stdout = "NVIDIA GPU, 12288\n"

        result = inspect_download_environment("hy-mt2-7b:q8_0")

        self.assertEqual(result["status"], "insufficient")
        self.assertIn("Q8_0", result["message"])
        self.assertEqual(result["recommended_model"], "hy-mt2-7b:q6_k")

if __name__ == "__main__":
    unittest.main()
