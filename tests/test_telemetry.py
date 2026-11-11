import subprocess
import unittest
from unittest.mock import Mock, patch
from local_translator.telemetry import GpuTelemetry

class TelemetryTests(unittest.TestCase):
    @patch('local_translator.gpu_provider.NvmlProvider', side_effect=OSError('no NVML'))
    @patch('local_translator.gpu_provider.subprocess.run')
    def test_multiple_gpus_partial_readings_and_cache(self, run, _nvml):
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

    @patch('local_translator.gpu_provider.NvmlProvider', side_effect=OSError('no NVML'))
    @patch('local_translator.gpu_provider.subprocess.run')
    def test_failure_does_not_report_zero_metrics(self, run, _nvml):
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

    def test_incremental_snapshot_has_strict_boundaries_and_latest_even_without_delta(self):
        monitor = GpuTelemetry()
        for stamp in (100, 100.5, 101):
            monitor._record({"timestamp": stamp, "gpus": [], "message": ""})
        with patch('local_translator.telemetry.time.time', return_value=101):
            full = monitor.snapshot()
            delta = monitor.snapshot(100.5)
            empty = monitor.snapshot(101)
            reset = monitor.snapshot(200)
        self.assertEqual([sample["timestamp"] for sample in delta["samples"]], [101])
        self.assertEqual(empty["samples"], [])
        self.assertEqual(empty["timestamp"], 101)
        self.assertEqual(empty["cursor"], 101)
        self.assertFalse(empty["reset"])
        self.assertTrue(reset["reset"])
        self.assertEqual(reset["samples"], full["samples"])
        self.assertEqual(full["session_id"], delta["session_id"])
        self.assertNotEqual(full["session_id"], GpuTelemetry().snapshot()["session_id"])

    def test_invalid_cursor_and_empty_initial_snapshot(self):
        monitor = GpuTelemetry()
        for invalid in (True, "1", -1, float('nan'), float('inf')):
            with self.assertRaises(ValueError):
                monitor.snapshot(invalid)
        snapshot = monitor.snapshot()
        self.assertIsNone(snapshot["cursor"])
        self.assertEqual(snapshot["provider_status"], "starting")
        self.assertFalse(snapshot["reset"])
        self.assertTrue(monitor.snapshot(1)["reset"])

    def test_snapshot_does_not_collect_and_prunes_elapsed_history(self):
        monitor = GpuTelemetry()
        monitor._record({"timestamp": 100, "gpus": [], "message": ""})
        monitor._record({"timestamp": 100, "gpus": [], "message": "duplicate"})
        with patch.object(monitor, 'sample') as sample:
            with patch('local_translator.telemetry.time.time', return_value=400):
                self.assertEqual(len(monitor.snapshot()["samples"]), 1)
            with patch('local_translator.telemetry.time.time', return_value=400.1):
                self.assertEqual(monitor.snapshot()["samples"], [])
            sample.assert_not_called()

    @patch('local_translator.telemetry.GpuProvider')
    def test_stop_closes_provider_without_started_thread(self, provider):
        monitor = GpuTelemetry()
        monitor.sample()
        monitor.stop()
        provider.return_value.close.assert_called_once()

    @patch('local_translator.telemetry.GpuProvider')
    def test_background_collector_releases_provider_on_stop(self, provider):
        import threading
        import time
        ready = threading.Event()
        def read():
            ready.set()
            return {"timestamp": time.time(), "gpus": [], "message": ""}
        provider.return_value.read.side_effect = read
        monitor = GpuTelemetry()
        for interval in (0.5, 1, 2, 5):
            monitor.configure(interval)
            self.assertEqual(monitor.snapshot()['interval'], interval)
        monitor.start()
        try:
            self.assertTrue(ready.wait(2))
        finally:
            monitor.stop()
        self.assertFalse(monitor._thread.is_alive())
        self.assertGreaterEqual(provider.return_value.close.call_count, 1)
