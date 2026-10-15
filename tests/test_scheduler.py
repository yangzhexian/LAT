import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock

from local_translator.config import Settings
from local_translator.engine import TranslationEngine, TranslationRequestError
from local_translator.errors import ModelBusyError
from local_translator.jobs import TranslationCancelled
from local_translator.scheduler import SchedulingError, TranslationScheduler


class SchedulerTests(unittest.TestCase):
    def setUp(self):
        self.now = 0.0
        self.scheduler = TranslationScheduler(clock=lambda: self.now)

    def admit(self, key, source="workspace"):
        cancel = threading.Event()
        self.scheduler.admit(key, source, cancel)
        return cancel

    def acquire(self, key):
        self.assertEqual(list(self.scheduler.acquire(key)), [])

    def test_selection_priority_and_fifo_position(self):
        self.admit("active")
        self.acquire("active")
        self.admit("workspace")
        self.admit("api", "api")
        self.admit("selection", "selection")
        self.assertEqual(next(self.scheduler.acquire("workspace"))["queue_position"], 2)
        self.assertEqual(next(self.scheduler.acquire("api"))["queue_position"], 3)
        waiting = next(self.scheduler.acquire("selection"))
        self.assertEqual(waiting["request_source"], "selection")
        self.assertEqual(waiting["queue_position"], 1)
        self.scheduler.finish("active")
        self.acquire("selection")
        self.scheduler.finish("selection")
        self.acquire("workspace")
        self.scheduler.finish("workspace")
        self.acquire("api")

    def test_selection_burst_is_bounded_with_waiting_workspace(self):
        self.admit("workspace")
        for index in range(3):
            key = f"selection-{index}"
            self.admit(key, "selection")
            self.acquire(key)
            self.scheduler.finish(key)
        self.admit("selection-next", "selection")
        self.assertEqual(next(self.scheduler.acquire("selection-next"))["queue_position"], 2)
        self.acquire("workspace")

    def test_aging_promotes_older_work_even_before_burst_limit(self):
        self.admit("workspace")
        self.now = 5.1
        self.admit("selection", "selection")
        self.acquire("workspace")

    def test_release_moves_document_to_back_of_its_class(self):
        self.admit("first")
        self.acquire("first")
        self.admit("second")
        self.scheduler.release("first")
        self.acquire("second")
        self.scheduler.finish("second")
        self.acquire("first")

    def test_bounded_admission_and_expired_ticket_does_not_block_next(self):
        self.scheduler = TranslationScheduler(max_pending=1, wait_timeout=10, clock=lambda: self.now)
        self.admit("active")
        self.acquire("active")
        self.admit("expired")
        with self.assertRaises(SchedulingError) as caught:
            self.admit("overflow")
        self.assertEqual(caught.exception.code, "translation_busy")
        self.now = 10
        self.scheduler.finish("active")
        self.admit("new")
        self.acquire("new")
        with self.assertRaises(SchedulingError) as caught:
            list(self.scheduler.acquire("expired"))
        self.assertEqual(caught.exception.code, "translation_queue_timeout")

    def test_cancelled_pending_ticket_is_skipped_and_shutdown_cancels_all(self):
        first = self.admit("first")
        self.acquire("first")
        cancelled = self.admit("cancelled", "selection")
        last = self.admit("last")
        cancelled.set()
        self.scheduler.finish("first")
        self.acquire("last")
        with self.assertRaises(TranslationCancelled):
            list(self.scheduler.acquire("cancelled"))
        self.scheduler.shutdown()
        self.assertTrue(last.is_set())
        self.assertFalse(first.is_set())
        with self.assertRaises(TranslationCancelled):
            list(self.scheduler.acquire("last"))
        with self.assertRaises(TranslationCancelled):
            self.admit("late")


class EchoClient:
    def __init__(self):
        self.calls = []
        self.lock = threading.Lock()
        self.running = 0
        self.max_running = 0
        self.entered = threading.Event()
        self.release = threading.Event()
        self.block_first = False

    def resolve_model(self):
        return "test-model"

    def chat_stream(self, model, messages, options):
        source = messages[0]["content"].split("\n\n", 1)[1]
        with self.lock:
            self.running += 1
            self.max_running = max(self.max_running, self.running)
            self.calls.append(source)
            first = len(self.calls) == 1
        try:
            if self.block_first and first:
                self.entered.set()
                if not self.release.wait(3):
                    raise AssertionError("test did not release inference")
            yield {"message": {"content": source}}
            yield {"done": True, "done_reason": "stop", "eval_count": 1}
        finally:
            with self.lock:
                self.running -= 1


class EngineSchedulerTests(unittest.TestCase):
    def setUp(self):
        self.client = EchoClient()
        self.manager = Mock()
        self.manager.ensure_server.return_value = self.client
        self.manager.require_ready_server.return_value = self.client
        self.engine = TranslationEngine(Settings(retry_on_bad_output=False), self.manager)
        self.streams = []

    def tearDown(self):
        for stream in self.streams:
            stream.close()

    def stream(self, text, source="workspace", **options):
        stream = self.engine.translate_stream(dict(text=text, target_language="Chinese", _request_source=source, **options))
        self.streams.append(stream)
        return stream

    def segment(self, stream):
        for event in stream:
            if event["type"] == "segment_complete":
                return event
        self.fail("missing completed segment")

    def test_selection_interleaves_only_after_validated_checkpoint(self):
        document = self.stream("First.\n\nSecond.")
        plan = next(document)
        selection = self.stream("Short.", "selection")
        waiting = next(selection)
        self.assertEqual(waiting["type"], "waiting")
        self.assertNotEqual(waiting["job_id"], plan["job_id"])
        self.assertEqual(self.segment(document)["completed_chunks"], 1)
        self.assertEqual(next(document)["type"], "waiting")
        self.assertEqual(list(selection)[-1]["translation"], "Short.")
        complete = list(document)[-1]
        self.assertEqual(complete["translation"], "First.\n\nSecond.")
        self.assertEqual(self.client.calls, ["First.", "Short.", "Second."])
        self.assertEqual(self.client.max_running, 1)

    def test_true_concurrent_requests_never_overlap_actual_model_calls(self):
        self.client.block_first = True
        document = self.stream("First.\n\nSecond.")
        selection = self.stream("Short.", "selection")
        waiting = threading.Event()
        def consume_selection():
            result = []
            for event in selection:
                result.append(event)
                if event["type"] == "waiting":
                    waiting.set()
            return result
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(list, document)
            try:
                self.assertTrue(self.client.entered.wait(2))
                second = pool.submit(consume_selection)
                self.assertTrue(waiting.wait(2))
            finally:
                self.client.release.set()
            self.assertEqual(first.result(timeout=3)[-1]["type"], "complete")
            self.assertEqual(second.result(timeout=3)[-1]["type"], "complete")
        self.assertEqual(self.client.calls, ["First.", "Short.", "Second."])
        self.assertEqual(self.client.max_running, 1)

    def test_queue_cancel_owner_and_disconnect_are_isolated(self):
        active = self.stream("First.")
        active_id = next(active)["job_id"]
        cancelled = self.stream("Cancelled.", _owner="one")
        job_id = next(cancelled)["job_id"]
        with self.assertRaises(TranslationRequestError):
            self.engine.cancel_translation(job_id, owner="other")
        self.engine.cancel_translation(job_id, owner="one")
        self.assertEqual(list(cancelled)[-1]["type"], "cancelled")
        disconnected = self.stream("Disconnected.")
        disconnected_id = next(disconnected)["job_id"]
        disconnected.close()
        self.assertFalse(self.engine._jobs[disconnected_id].live)
        self.assertFalse(self.engine._jobs[active_id].cancel.is_set())
        self.assertEqual(list(active)[-1]["type"], "complete")
        self.assertEqual(self.client.calls, ["First."])
        self.assertFalse(self.engine.scheduler.busy)

    def test_transport_cancel_is_preserved_on_resume(self):
        stream = self.stream("First.")
        job_id = next(stream)["job_id"]
        stream.close()
        cancelled = threading.Event()
        cancelled.set()
        events = list(self.stream("First.", job_id=job_id, _cancel=cancelled))
        self.assertEqual(events[-1]["type"], "cancelled")
        self.assertTrue(cancelled.is_set())
        self.assertEqual(self.client.calls, [])

    def test_duplicate_resume_cannot_clear_live_cancellation(self):
        active = self.stream("First.")
        job_id = next(active)["job_id"]
        self.engine.cancel_translation(job_id)
        with self.assertRaises(TranslationRequestError) as caught:
            list(self.stream("First.", job_id=job_id))
        self.assertEqual(caught.exception.code, "translation_busy")
        self.assertTrue(self.engine._jobs[job_id].cancel.is_set())
        self.assertEqual(list(active)[-1]["type"], "cancelled")
        self.assertEqual(list(self.stream("First.", job_id=job_id))[-1]["type"], "complete")

    def test_queued_resume_is_exclusive_and_prompt_cache_change_invalidates_checkpoint(self):
        active = self.stream("Active.")
        next(active)
        queued = self.stream("First.")
        job_id = next(queued)["job_id"]
        with self.assertRaises(TranslationRequestError) as caught:
            list(self.stream("First.", job_id=job_id))
        self.assertEqual(caught.exception.code, "translation_busy")
        queued.close()
        active.close()
        self.engine.settings.cache_prompt = not self.engine.settings.cache_prompt
        with self.assertRaises(TranslationRequestError) as caught:
            list(self.stream("First.", job_id=job_id))
        self.assertEqual(caught.exception.code, "checkpoint_mismatch")

    def test_management_rejected_between_segments_and_while_only_queued(self):
        active = self.stream("First.\n\nSecond.")
        next(active)
        queued = self.stream("Queued.")
        next(queued)
        self.segment(active)
        self.assertIsNone(self.engine._active_job)
        with self.assertRaises(ModelBusyError), self.engine.management():
            pass
        active.close()
        with self.assertRaises(ModelBusyError), self.engine.management():
            pass
        queued.close()
        with self.engine.management():
            pass

    def test_timeout_preserves_partial_checkpoint_and_can_resume(self):
        now = [0.0]
        self.engine.scheduler = TranslationScheduler(wait_timeout=10, clock=lambda: now[0])
        document = self.stream("First.\n\nSecond.")
        job_id = next(document)["job_id"]
        self.segment(document)
        selection = self.stream("Short.", "selection")
        next(selection)
        waiting = next(document)
        self.assertEqual(waiting["type"], "waiting")
        now[0] = 10
        with self.assertRaises(TranslationRequestError) as caught:
            list(document)
        self.assertEqual(caught.exception.code, "translation_queue_timeout")
        self.assertEqual(self.engine._jobs[job_id].completed, ["First.\n\n"])
        selection.close()
        resumed = list(self.stream("First.\n\nSecond.", job_id=job_id))
        self.assertEqual(resumed[0]["translation"], "First.\n\n")
        self.assertEqual(resumed[-1]["translation"], "First.\n\nSecond.")
        self.assertEqual(self.client.calls, ["First.", "Second."])

    def test_finished_last_segment_does_not_block_next_job_before_terminal_event(self):
        active = self.stream("First.")
        next(active)
        queued = self.stream("Second.")
        next(queued)
        self.segment(active)
        self.assertEqual(list(queued)[-1]["type"], "complete")
        self.assertEqual(list(active)[-1]["type"], "complete")

    def test_slow_ready_probe_does_not_hold_admission_or_inference(self):
        probing, release = threading.Event(), threading.Event()
        def ready():
            probing.set()
            if not release.wait(3):
                raise AssertionError("test did not release health probe")
            return self.client
        self.manager.require_ready_server.side_effect = ready
        waiting = self.stream("Ready.", require_ready=True)
        with ThreadPoolExecutor(max_workers=1) as pool:
            checked = pool.submit(next, waiting)
            try:
                self.assertTrue(probing.wait(2))
                other = self.stream("Other.")
                self.assertEqual(next(other)["type"], "plan")
                other.close()
            finally:
                release.set()
            self.assertEqual(checked.result(timeout=3)["type"], "plan")

    def test_shutdown_interrupts_actual_inference_and_releases_pending(self):
        entered, closed = threading.Event(), threading.Event()
        def infer(_model, _messages, options):
            entered.set()
            try:
                if not options["_cancel"].wait(3):
                    raise AssertionError("shutdown did not cancel active inference")
                raise TranslationCancelled()
                yield
            finally:
                closed.set()
        self.client.chat_stream = infer
        active = self.stream("First.")
        with ThreadPoolExecutor(max_workers=1) as pool:
            running = pool.submit(list, active)
            try:
                self.assertTrue(entered.wait(2))
                queued = self.stream("Queued.")
                self.assertEqual(next(queued)["type"], "waiting")
            finally:
                self.engine.begin_shutdown()
            self.assertEqual(running.result(timeout=3)[-1]["type"], "cancelled")
            self.assertEqual(list(queued)[-1]["type"], "cancelled")
        self.assertTrue(closed.is_set())
        self.assertFalse(self.engine.scheduler.busy)

    def test_shutdown_cancels_active_and_waiting_without_loading_model(self):
        active = self.stream("First.")
        next(active)
        queued = self.stream("Queued.")
        next(queued)
        self.engine.begin_shutdown()
        self.assertEqual(list(active)[-1]["type"], "cancelled")
        self.assertEqual(list(queued)[-1]["type"], "cancelled")
        self.assertEqual(self.client.calls, [])
        self.assertFalse(self.engine.scheduler.busy)

    def test_live_jobs_survive_checkpoint_expiry_and_lru_pressure(self):
        active = self.stream("First.")
        live_ids = [next(active)["job_id"]]
        for index in range(8):
            live_ids.append(next(self.stream(f"Queued {index}."))["job_id"])
        for job_id in live_ids:
            self.engine._jobs[job_id].updated_at -= 3601
        for index in range(12):
            self.engine._get_job({"text": f"Inactive {index}.", "target_language": "Chinese"})
        self.assertTrue(all(self.engine._jobs[job_id].live for job_id in live_ids))
        before = list(self.engine._jobs)
        with self.assertRaises(TranslationRequestError) as caught:
            list(self.stream("Overflow."))
        self.assertEqual(caught.exception.code, "translation_busy")
        self.assertEqual(list(self.engine._jobs), before)
        for stream in self.streams:
            stream.close()
        self.assertLessEqual(len(self.engine._jobs), 8)

    def test_new_checkpoint_is_protected_until_admission_marks_it_live(self):
        previous = [self.stream(f"Old {index}.") for index in range(8)]
        for stream in previous:
            next(stream)
        entered, release = threading.Event(), threading.Event()
        original = self.engine.scheduler.admit
        def admit(job_id, source, cancel):
            # Make this checkpoint the oldest inactive candidate. Completing
            # eight previous requests would evict it before the fix.
            self.engine._jobs[job_id].updated_at -= 1
            entered.set()
            if not release.wait(3):
                raise AssertionError("test did not release admission")
            original(job_id, source, cancel)
        self.engine.scheduler.admit = admit
        new = self.stream("New.")
        with ThreadPoolExecutor(max_workers=1) as pool:
            incoming = pool.submit(next, new)
            try:
                self.assertTrue(entered.wait(2))
                # A finishing request must not enter its pruning critical
                # section during this gap. Test without scheduling sleeps.
                acquired = self.engine._jobs_lock.acquire(blocking=False)
                if acquired:
                    self.engine._jobs_lock.release()
                self.assertFalse(acquired, "checkpoint pruning can race live registration")
            finally:
                release.set()
            job_id = incoming.result(timeout=3)["job_id"]
        for stream in previous:
            stream.close()
        self.assertTrue(self.engine._jobs[job_id].live)
        self.engine.cancel_translation(job_id)
        self.assertEqual(list(new)[-1]["type"], "cancelled")


if __name__ == "__main__":
    unittest.main()
