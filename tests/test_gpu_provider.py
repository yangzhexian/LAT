import ctypes
import os
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from local_translator.gpu_provider import GpuProvider, NvmlError, NvmlMemory, NvmlProvider, NvmlUtilization, load_nvml


def fake_library(count=2):
    """Native-shaped exports fill actual ctypes pointers, without GPU access."""
    def write(pointer, kind, value):
        ctypes.cast(pointer, ctypes.POINTER(kind)).contents.value = value
        return 0

    def memory(device, pointer):
        value = ctypes.cast(pointer, ctypes.POINTER(NvmlMemory)).contents
        value.total, value.free, value.used = 12 * 1048576, 9 * 1048576, 3 * 1048576 + 524288
        return 0

    def utilization(device, pointer):
        ctypes.cast(pointer, ctypes.POINTER(NvmlUtilization)).contents.gpu = 0 if device.value == 1 else 65
        return 0

    def string(value, buffer):
        buffer.value = value
        return 0

    return SimpleNamespace(
        nvmlInit_v2=Mock(return_value=0), nvmlShutdown=Mock(return_value=0),
        nvmlDeviceGetCount_v2=Mock(side_effect=lambda pointer: write(pointer, ctypes.c_uint, count)),
        nvmlDeviceGetHandleByIndex_v2=Mock(side_effect=lambda index, pointer: write(pointer, ctypes.c_void_p, index + 1)),
        nvmlDeviceGetUUID=Mock(side_effect=lambda device, buffer, length: string(f'GPU-{device.value}'.encode(), buffer)),
        nvmlDeviceGetName=Mock(side_effect=lambda device, buffer, length: string(b'NVIDIA Test GPU', buffer)),
        nvmlDeviceGetMemoryInfo=Mock(side_effect=memory),
        nvmlDeviceGetUtilizationRates=Mock(side_effect=utilization),
        nvmlDeviceGetPowerUsage=Mock(side_effect=lambda device, pointer: write(pointer, ctypes.c_uint, 42690)),
        nvmlDeviceGetPowerManagementLimit=Mock(side_effect=lambda device, pointer: write(pointer, ctypes.c_uint, 250000)),
        nvmlDeviceGetTemperature=Mock(side_effect=lambda device, sensor, pointer: write(pointer, ctypes.c_uint, 54)),
    )


class NvmlTests(unittest.TestCase):
    @patch('local_translator.gpu_provider.subprocess.run')
    def test_persistent_handles_multiple_gpus_units_and_cleanup(self, run):
        native = fake_library()
        with patch('local_translator.gpu_provider.load_nvml', return_value=native) as load:
            provider = GpuProvider()
            first = provider.read()
            second = provider.read()
            provider.close()
            provider.close()
        self.assertEqual(first['provider'], 'nvml')
        self.assertEqual(first['provider_status'], 'ok')
        self.assertEqual(first['gpus'], second['gpus'])
        self.assertEqual([gpu['id'] for gpu in first['gpus']], ['GPU-1', 'GPU-2'])
        self.assertEqual(first['gpus'][0]['memory_used_mib'], 3.5)
        self.assertEqual(first['gpus'][0]['memory_total_mib'], 12)
        self.assertEqual(first['gpus'][0]['utilization_pct'], 0)
        self.assertEqual(first['gpus'][1]['utilization_pct'], 65)
        self.assertEqual(first['gpus'][0]['power_w'], 42.69)
        self.assertEqual(first['gpus'][0]['power_limit_w'], 250)
        self.assertEqual(first['gpus'][0]['temperature_c'], 54)
        load.assert_called_once()
        native.nvmlInit_v2.assert_called_once()
        native.nvmlDeviceGetCount_v2.assert_called_once()
        self.assertEqual(native.nvmlDeviceGetHandleByIndex_v2.call_count, 2)
        self.assertEqual(native.nvmlDeviceGetUUID.call_count, 2)
        self.assertEqual(native.nvmlDeviceGetName.call_count, 2)
        native.nvmlShutdown.assert_called_once()
        self.assertEqual(native.nvmlDeviceGetMemoryInfo.argtypes, [ctypes.c_void_p, ctypes.POINTER(NvmlMemory)])
        self.assertEqual(native.nvmlDeviceGetMemoryInfo.restype, ctypes.c_int)
        run.assert_not_called()

    @patch('local_translator.gpu_provider.subprocess.run')
    def test_unsupported_fields_and_missing_export_stay_null(self, run):
        native = fake_library()
        native.nvmlDeviceGetMemoryInfo.side_effect = None
        native.nvmlDeviceGetMemoryInfo.return_value = 3
        native.nvmlDeviceGetPowerUsage.side_effect = None
        native.nvmlDeviceGetPowerUsage.return_value = 3
        del native.nvmlDeviceGetTemperature
        with patch('local_translator.gpu_provider.load_nvml', return_value=native):
            provider = GpuProvider()
            result = provider.read()
            provider.close()
        self.assertEqual(result['provider'], 'nvml')
        self.assertEqual(result['provider_status'], 'partial')
        for gpu in result['gpus']:
            for key in ('memory_used_mib', 'memory_total_mib', 'power_w', 'temperature_c'):
                self.assertIsNone(gpu[key])
            self.assertEqual(gpu['power_limit_w'], 250)
        run.assert_not_called()

    def test_initialization_failure_and_enumeration_cleanup(self):
        for failure, shutdown_calls in (('nvmlInit_v2', 0), ('nvmlDeviceGetCount_v2', 1), ('nvmlDeviceGetUUID', 1)):
            with self.subTest(failure=failure):
                native = fake_library()
                function = getattr(native, failure)
                function.side_effect, function.return_value = None, 9
                with patch('local_translator.gpu_provider.load_nvml', return_value=native):
                    with self.assertRaises(NvmlError):
                        NvmlProvider()
                self.assertEqual(native.nvmlShutdown.call_count, shutdown_calls)

    @patch('local_translator.gpu_provider.subprocess.run')
    def test_runtime_driver_loss_switches_to_fallback_once(self, run):
        native = fake_library()
        run.return_value = Mock(returncode=0, stdout='GPU-1, Test, 1, 12, 20, 42.69, 250, 54\n')
        with patch('local_translator.gpu_provider.load_nvml', return_value=native):
            provider = GpuProvider()
            self.assertEqual(provider.read()['provider'], 'nvml')
            native.nvmlDeviceGetPowerUsage.side_effect = None
            native.nvmlDeviceGetPowerUsage.return_value = 15
            first = provider.read()
            second = provider.read()
            provider.close()
        self.assertEqual(first['provider_status'], 'fallback')
        self.assertEqual(first['gpus'][0]['id'], 'GPU-1')
        self.assertIn('15', first['provider_message'])
        self.assertEqual(first['timestamp'], second['timestamp'])
        native.nvmlInit_v2.assert_called_once()
        native.nvmlShutdown.assert_called_once()
        run.assert_called_once()

    def test_legacy_initialization_exports(self):
        native = fake_library(1)
        for name in ('nvmlInit', 'nvmlDeviceGetCount', 'nvmlDeviceGetHandleByIndex'):
            setattr(native, name, getattr(native, name + '_v2'))
            delattr(native, name + '_v2')
        with patch('local_translator.gpu_provider.load_nvml', return_value=native):
            provider = NvmlProvider()
            self.assertEqual(len(provider.read()), 1)
            provider.close()

    @patch('local_translator.gpu_provider.subprocess.run')
    def test_missing_required_export_falls_back_without_initializing(self, run):
        native = fake_library()
        del native.nvmlDeviceGetUUID
        run.return_value = Mock(returncode=1, stdout='')
        with patch('local_translator.gpu_provider.load_nvml', return_value=native) as load:
            provider = GpuProvider()
            result = provider.read()
            provider.read()
            provider.close()
        self.assertEqual(result['provider_status'], 'unavailable')
        self.assertIn('nvmlDeviceGetUUID', result['provider_message'])
        load.assert_called_once()
        native.nvmlInit_v2.assert_not_called()
        native.nvmlShutdown.assert_not_called()
        run.assert_called_once()

    @patch('local_translator.gpu_provider.subprocess.run')
    def test_no_devices_has_unavailable_status_without_spawning_process(self, run):
        native = fake_library(0)
        with patch('local_translator.gpu_provider.load_nvml', return_value=native):
            provider = GpuProvider()
            result = provider.read()
            provider.close()
        self.assertEqual(result['gpus'], [])
        self.assertEqual(result['provider_status'], 'unavailable')
        native.nvmlShutdown.assert_called_once()
        run.assert_not_called()

    def test_sentinel_metrics_are_unknown(self):
        native = fake_library(1)
        def memory(device, pointer):
            value = ctypes.cast(pointer, ctypes.POINTER(NvmlMemory)).contents
            value.used = value.total = 0xFFFFFFFFFFFFFFFF
            return 0
        def scalar(device, pointer):
            ctypes.cast(pointer, ctypes.POINTER(ctypes.c_uint)).contents.value = 0xFFFFFFFF
            return 0
        native.nvmlDeviceGetMemoryInfo.side_effect = memory
        native.nvmlDeviceGetPowerUsage.side_effect = scalar
        with patch('local_translator.gpu_provider.load_nvml', return_value=native):
            provider = NvmlProvider()
            gpu = provider.read()[0]
            provider.close()
        self.assertIsNone(gpu['memory_used_mib'])
        self.assertIsNone(gpu['memory_total_mib'])
        self.assertIsNone(gpu['power_w'])

    @unittest.skipUnless(os.name == 'nt', 'Windows driver paths')
    @patch('local_translator.gpu_provider.ctypes.CDLL', side_effect=[OSError('missing'), object()])
    def test_windows_uses_driver_paths_without_cwd_search(self, load):
        load_nvml()
        paths = [call.args[0] for call in load.call_args_list]
        self.assertEqual(len(paths), 2)
        self.assertTrue(all(os.path.isabs(path) for path in paths))
        self.assertTrue(paths[0].endswith('System32\\nvml.dll'))
        self.assertTrue(paths[1].endswith('NVIDIA Corporation\\NVSMI\\nvml.dll'))


class FallbackTests(unittest.TestCase):
    @patch('local_translator.gpu_provider.time.monotonic')
    @patch('local_translator.gpu_provider.NvmlProvider', side_effect=NvmlError('incompatible driver'))
    @patch('local_translator.gpu_provider.subprocess.run')
    def test_fallback_is_hidden_bounded_and_throttled(self, run, nvml, clock):
        clock.return_value = 10
        run.return_value = Mock(returncode=0, stdout='GPU-1, Test, N/A, 12288, 0, [Not Supported], 250, nan\ninvalid\n')
        provider = GpuProvider()
        first = provider.read()
        clock.return_value = 10.5
        self.assertIs(provider.read(), first)
        clock.return_value = 12
        second = provider.read()
        self.assertEqual(run.call_count, 2)
        nvml.assert_called_once()
        self.assertEqual(first['provider_interval'], 2)
        self.assertEqual(second['provider_message'], 'incompatible driver')
        self.assertIsNone(first['gpus'][0]['memory_used_mib'])
        self.assertIsNone(first['gpus'][0]['power_w'])
        self.assertIsNone(first['gpus'][0]['temperature_c'])
        self.assertEqual(first['gpus'][0]['utilization_pct'], 0)
        self.assertEqual(run.call_args.kwargs['timeout'], 2)
        self.assertEqual(run.call_args.kwargs['creationflags'], getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        self.assertNotIn('shell', run.call_args.kwargs)

    @patch('local_translator.gpu_provider.time.monotonic')
    @patch('local_translator.gpu_provider.NvmlProvider', side_effect=NvmlError('missing driver'))
    @patch('local_translator.gpu_provider.subprocess.run')
    def test_missing_driver_timeout_and_recovery(self, run, nvml, clock):
        clock.return_value = 0
        run.side_effect = [subprocess.TimeoutExpired('nvidia-smi', 2), Mock(returncode=0, stdout='GPU-1, Test, 1, 12, 0, 10, 200, 30\n')]
        provider = GpuProvider()
        first = provider.read()
        self.assertEqual(first['gpus'], [])
        self.assertEqual(first['provider_status'], 'unavailable')
        self.assertEqual(first['provider_interval'], 5)
        clock.return_value = 4.9
        self.assertIs(provider.read(), first)
        clock.return_value = 5
        self.assertEqual(provider.read()['provider_status'], 'fallback')
        nvml.assert_called_once()
        self.assertEqual(run.call_count, 2)


if __name__ == '__main__':
    unittest.main()
