import subprocess
import unittest
from unittest.mock import Mock, patch
from local_translator.telemetry import GpuTelemetry

class TelemetryTests(unittest.TestCase):
    @patch('local_translator.telemetry.subprocess.run')
    def test_multiple_gpus_partial_readings_and_cache(self, run):
        run.return_value = Mock(returncode=0, stdout='gpu-1, RTX 5070, 4011, 12227, 20, 42.69, 250, 54\ngpu-2, GPU, N/A, 24576, 0, [Not Supported], 300, nan\n')
        monitor = GpuTelemetry()
        result = monitor.sample()
        self.assertEqual(len(result['gpus']), 2)
        self.assertEqual(result['gpus'][0]['temperature_c'], 54)
        self.assertIsNone(result['gpus'][1]['power_w'])
        self.assertIsNone(result['gpus'][1]['temperature_c'])
        self.assertEqual(result['gpus'][1]['utilization_pct'], 0)
        self.assertEqual(monitor.sample(), result)
        run.assert_called_once()
        self.assertEqual(run.call_args.kwargs['timeout'], 2)

    @patch('local_translator.telemetry.subprocess.run')
    def test_failure_does_not_report_zero_metrics(self, run):
        run.side_effect = subprocess.TimeoutExpired('nvidia-smi', 2)
        result = GpuTelemetry().sample()
        self.assertEqual(result['gpus'], [])
        self.assertTrue(result['message'])
