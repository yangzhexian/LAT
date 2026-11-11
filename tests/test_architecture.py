import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from local_translator.model_metadata import ArchitectureMetadataCache


class ArchitectureResponseTests(unittest.TestCase):
    def test_cached_response_and_conditional_get_never_copy_or_reserialize(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'test.gguf'
            path.write_bytes(b'fixture')
            value = {'model': 'fixture', 'block_tensors': [{'shape': [4, 8]}] * 100}
            cache = ArchitectureMetadataCache()
            with patch('local_translator.model_metadata.read_architecture', return_value=value) as read:
                etag, body = cache.response(path, 'model')
                self.assertEqual(json.loads(body), {'architecture': value})
                with patch('local_translator.model_metadata.copy.deepcopy', side_effect=AssertionError('no copy')), patch('local_translator.model_metadata.json.dumps', side_effect=AssertionError('no serialization')):
                    self.assertIs(cache.response(path, 'model')[1], body)
                    for validator in (etag, 'W/' + etag, '"other", W/' + etag, '*'):
                        self.assertEqual(cache.response(path, 'model', validator), (etag, None))
                    self.assertEqual(cache.response(path, 'model', '"other"'), (etag, body))
                read.assert_called_once()

    def test_file_model_and_missing_file_changes_invalidate_validator(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'test.gguf'
            cache = ArchitectureMetadataCache()
            def read(path, model):
                return {'model': model, 'fixture': path.read_bytes().hex() if path.exists() else None}
            with patch('local_translator.model_metadata.read_architecture', side_effect=read) as reader:
                missing_tag, _ = cache.response(path, 'first')
                path.write_bytes(b'one')
                first_tag, first_body = cache.response(path, 'first', missing_tag)
                self.assertNotEqual(missing_tag, first_tag)
                self.assertIsNotNone(first_body)
                stat = path.stat()
                path.write_bytes(b'two')
                os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))
                second_tag, second_body = cache.response(path, 'first', first_tag)
                self.assertNotEqual(first_tag, second_tag)
                self.assertEqual(json.loads(second_body)['architecture']['fixture'], b'two'.hex())
                third_tag, third_body = cache.response(path, 'second', second_tag)
                self.assertNotEqual(third_tag, second_tag)
                self.assertEqual(json.loads(third_body)['architecture']['model'], 'second')
                self.assertEqual(reader.call_count, 4)

    def test_legacy_snapshot_still_isolates_nested_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'missing.gguf'
            cache = ArchitectureMetadataCache()
            with patch('local_translator.model_metadata.read_architecture', return_value={'block_tensors': [{'shape': [4, 8]}]}):
                etag, response = cache.response(path, 'model')
                snapshot = cache.snapshot(path, 'model')
                snapshot['block_tensors'][0]['shape'][0] = 999
                self.assertEqual(cache.snapshot(path, 'model')['block_tensors'][0]['shape'], [4, 8])
                self.assertEqual(cache.response(path, 'model', etag), (etag, None))
                self.assertEqual(json.loads(response)['architecture']['block_tensors'][0]['shape'], [4, 8])


if __name__ == '__main__':
    unittest.main()
