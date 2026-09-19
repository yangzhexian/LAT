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

    def test_background_collection_precedes_dashboard_and_stops_cleanly(self):
        import threading
        import time
        monitor = GpuTelemetry()
        monitor.configure(0.5)
        ready = threading.Event()
        calls = []
        def sample(**kwargs):
            calls.append(time.monotonic())
            if len(calls) >= 3:
                ready.set()
            return {"timestamp": time.time(), "gpus": [], "message": "test"}
        with patch.object(monitor, "sample", side_effect=sample):
            monitor.start()
            thread = monitor._thread
            monitor.start()
            self.assertIs(monitor._thread, thread)
            try:
                self.assertTrue(ready.wait(3))
                snapshot = monitor.snapshot()
                self.assertGreaterEqual(len(snapshot["samples"]), 2)
                self.assertEqual(snapshot["interval"], 0.5)
            finally:
                monitor.stop()
            self.assertFalse(thread.is_alive())
            self.assertGreaterEqual(calls[-1] - calls[0], 0.9)

    def test_history_retains_five_minutes_at_half_second_resolution(self):
        monitor = GpuTelemetry()
        for index in range(801):
            monitor._record({"timestamp": index / 2, "gpus": [], "message": ""})
        with patch('local_translator.telemetry.time.time', return_value=400):
            history = monitor.snapshot()["samples"]
        self.assertEqual(len(history), 601)
        self.assertEqual(history[0]["timestamp"], 100)
        self.assertEqual(history[-1]["timestamp"], 400)
        for invalid in (None, True, 0, 0.1, 10, "0.5"):
            with self.assertRaises(ValueError):
                monitor.configure(invalid)
