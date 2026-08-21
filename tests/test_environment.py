import unittest
from unittest.mock import patch

from local_translator.environment import inspect_download_environment


class EnvironmentTests(unittest.TestCase):
    @patch("local_translator.environment.subprocess.run")
    def test_reports_ready_gpu(self, run):
        run.return_value.returncode = 0
        run.return_value.stdout = "NVIDIA GeForce RTX 5070, 12288, 10240\n"

        result = inspect_download_environment()

        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["best_gpu"]["name"], "NVIDIA GeForce RTX 5070")
        self.assertEqual(result["best_gpu"]["total_vram_gib"], 12.0)

    @patch("local_translator.environment.subprocess.run")
    def test_warns_when_gpu_is_too_small(self, run):
        run.return_value.returncode = 0
        run.return_value.stdout = "NVIDIA GPU, 6144, 6144\n"

        result = inspect_download_environment()

        self.assertEqual(result["status"], "insufficient")
        self.assertIn("1.8B", result["suggestion"])


if __name__ == "__main__":
    unittest.main()
