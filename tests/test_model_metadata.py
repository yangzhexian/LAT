import io
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

from local_translator.model_metadata import ArchitectureMetadataCache, read_architecture


def gguf_string(value, endian="<"):
    raw = value.encode()
    return struct.pack(endian + "Q", len(raw)) + raw


def gguf_fixture(endian="<", *, extra_metadata=None, tensors=None):
    metadata = {"general.architecture": "hunyuan-dense", "general.name": "local test model", "general.file_type": 18,
                "hunyuan-dense.block_count": 28, "hunyuan-dense.embedding_length": 4096,
                "hunyuan-dense.attention.head_count": 32, "hunyuan-dense.attention.head_count_kv": 8}
    metadata.update(extra_metadata or {})
    tensors = tensors if tensors is not None else (("token_embd.weight", (16, 32)), ("blk.0.attn.weight", (4, 8)))
    data = b"GGUF" + struct.pack(endian + "IQQ", 3, len(tensors), len(metadata) + 1)
    for key, value in metadata.items():
        data += gguf_string(key, endian)
        if isinstance(value, str):
            data += struct.pack(endian + "I", 8) + gguf_string(value, endian)
        else:
            data += struct.pack(endian + "II", 4, value)
    data += gguf_string("tokenizer.ggml.tokens", endian) + struct.pack(endian + "IIQ", 9, 8, 2)
    data += gguf_string("private token A", endian) + gguf_string("private token B", endian)
    for name, shape in tensors:
        data += gguf_string(name, endian) + struct.pack(endian + "I", len(shape))
        data += b"".join(struct.pack(endian + "Q", dim) for dim in shape)
        data += struct.pack(endian + "IQ", 14, 0)
    return data


class ModelMetadataTests(unittest.TestCase):
    def test_reads_shapes_and_architecture_without_reading_tensor_data(self):
        header = gguf_fixture()
        class GuardedFile(io.BytesIO):
            def read(self, count=-1):
                if count < 0 or self.tell() + count > len(header):
                    raise AssertionError("weight data must not be read")
                return super().read(count)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.gguf"
            path.write_bytes(header + b"weight data is off limits")
            with patch.object(Path, "open", return_value=GuardedFile(header + b"weight data is off limits")):
                value = read_architecture(path, "selected-model")
        self.assertTrue(value["available"])
        self.assertEqual(value["architecture"], "hunyuan-dense")
        self.assertEqual(value["block_count"], 28)
        self.assertEqual(value["parameter_count"], 544)
        self.assertEqual(value["quantization"], "Q6_K")
        self.assertIsNone(value["expert_count"])
        self.assertEqual(value["model"], "selected-model")
        self.assertEqual(value["vocab_size"], 32)
        self.assertEqual(value["head_dim"], 128)
        self.assertEqual(value["block_tensors"], [{"layer": 1, "name": "blk.0.attn.weight", "shape": [4, 8], "elements": 32}])
        self.assertNotIn("private token", str(value))

    def test_big_endian_gguf_is_supported(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.gguf"
            path.write_bytes(gguf_fixture(">"))
            self.assertEqual(read_architecture(path, "model")["block_count"], 28)

    def test_missing_corrupt_or_unbounded_header_returns_unknown(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.gguf"
            self.assertFalse(read_architecture(path, "model")["available"])
            for content in (b"not GGUF", gguf_fixture()[:70], b"GGUF" + struct.pack("<IQQ", 3, 2**60, 1),
                            b"GGUF" + struct.pack("<IQQQ", 3, 0, 1, 2**60)):
                path.write_bytes(content)
                value = read_architecture(path, "model")
                self.assertFalse(value["available"])
                self.assertIsNone(value["block_count"])

    def test_cache_invalidates_when_selected_model_or_file_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.gguf"
            path.write_bytes(gguf_fixture())
            cache = ArchitectureMetadataCache()
            with patch("local_translator.model_metadata.read_architecture", wraps=read_architecture) as read:
                cache.snapshot(path, "first")
                cache.snapshot(path, "first")
                self.assertEqual(read.call_count, 1)
                self.assertEqual(cache.snapshot(path, "second")["model"], "second")
                path.write_bytes(b"invalid")
                self.assertFalse(cache.snapshot(path, "second")["available"])
                self.assertEqual(read.call_count, 3)

    def test_each_block_uses_stored_shapes_and_explicit_head_dimension(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.gguf"
            path.write_bytes(gguf_fixture(extra_metadata={"hunyuan-dense.attention.key_length": 64}, tensors=(
                ("token_embd.weight", (4096, 128167)), ("blk.0.attn_q.weight", (4096, 4096)),
                ("blk.31.attn_k.weight", (4096, 1024)), ("blk.31.ffn_down.weight", (14336, 4096)),
                ("output_norm.weight", (4096,)),
            )))
            value = read_architecture(path, "model")
        self.assertEqual(value["head_dim"], 64)
        self.assertEqual(value["vocab_size"], 128167)
        self.assertEqual([tensor["layer"] for tensor in value["block_tensors"]], [1, 32, 32])
        self.assertEqual(value["block_tensors"][-1]["shape"], [14336, 4096])
        self.assertFalse(value["block_tensors_truncated"])

    def test_tensor_display_cap_preserves_full_parameter_count(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.gguf"
            path.write_bytes(gguf_fixture(tensors=(("blk.0.attn_q.weight", (4, 8)), ("blk.1.attn_q.weight", (4, 8)))))
            with patch("local_translator.model_metadata.MAX_BLOCK_TENSORS", 1):
                value = read_architecture(path, "model")
        self.assertEqual(len(value["block_tensors"]), 1)
        self.assertTrue(value["block_tensors_truncated"])
        self.assertEqual(value["parameter_count"], 64)

    def test_nested_tensor_cache_is_isolated_and_unknown_architecture_has_no_derived_head_dimension(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.gguf"
            path.write_bytes(gguf_fixture(extra_metadata={"general.architecture": "unrecognized"}))
            cache = ArchitectureMetadataCache()
            first = cache.snapshot(path, "model")
            self.assertIsNone(first["head_dim"])
            first["block_tensors"][0]["shape"][0] = 999
            self.assertEqual(cache.snapshot(path, "model")["block_tensors"][0]["shape"], [4, 8])


if __name__ == "__main__":
    unittest.main()
