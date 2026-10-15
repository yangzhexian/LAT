"""Bounded, cooperative inference scheduling at validated segment boundaries."""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Callable

from .jobs import TranslationCancelled


class SchedulingError(ValueError):
    def __init__(self, message: str, code: str):
        super().__init__(message)
        self.code = code


@dataclass
class _Ticket:
    source: str
    cancel: threading.Event
    waiting_since: float
    sequence: int
    waiting: bool = True


class TranslationScheduler:
    """One inference lease, with bounded admission and starvation protection.

    Every admitted document retains its slot until completion/disconnection.
    Releasing a segment places it at the back of its priority class, without
    needing another admission slot. A selection burst is capped at three when
    ordinary work waits; aging additionally promotes any ticket after 5 s.
    """

    def __init__(self, max_pending: int = 8, wait_timeout: float = 120,
                 *, clock: Callable[[], float] = time.monotonic):
        self.max_pending = max_pending
        self.wait_timeout = wait_timeout
        self._clock = clock
        self._condition = threading.Condition()
        self._tickets: dict[str, _Ticket] = {}
        self._active: str | None = None
        self._sequence = 0
        self._selection_burst = 0
        self._stopping = False

    @property
    def busy(self) -> bool:
        with self._condition:
            return bool(self._tickets)

    def admit(self, job_id: str, source: str, cancel: threading.Event) -> None:
        with self._condition:
            if self._stopping:
                cancel.set()
                raise TranslationCancelled()
            if job_id in self._tickets:
                raise SchedulingError("translation_busy: 此任务仍在运行或等待，请稍后继续", "translation_busy")
            self.check_capacity()
            self._sequence += 1
            self._tickets[job_id] = _Ticket(source, cancel, self._clock(), self._sequence)
            self._condition.notify_all()

    def check_capacity(self) -> None:
        """Reject overflow before allocating or pruning a new checkpoint."""
        with self._condition:
            if len(self._tickets) >= self.max_pending + 1:
                raise SchedulingError("translation_busy: 翻译等待队列已满，请稍后重试", "translation_busy")

    def _ordered(self, now: float) -> list[str]:
        pending = [(key, ticket) for key, ticket in self._tickets.items()
                   if key != self._active and ticket.waiting and not ticket.cancel.is_set()
                   and now - ticket.waiting_since < self.wait_timeout]
        ordinary_waiting = any(ticket.source != "selection" for _, ticket in pending)

        def priority(item):
            _, ticket = item
            if now - ticket.waiting_since >= 5:
                return (0, ticket.sequence)
            if ordinary_waiting and self._selection_burst >= 3:
                return (1 if ticket.source != "selection" else 2, ticket.sequence)
            return (1 if ticket.source == "selection" else 2, ticket.sequence)

        return [key for key, _ in sorted(pending, key=priority)]

    def acquire(self, job_id: str):
        """Yield cancellable queue updates until this request owns inference."""
        previous_position = None
        last_update = float("-inf")
        while True:
            with self._condition:
                ticket = self._tickets[job_id]
                if self._stopping or ticket.cancel.is_set():
                    raise TranslationCancelled()
                if self._active == job_id:
                    return
                now = self._clock()
                if now - ticket.waiting_since >= self.wait_timeout:
                    raise SchedulingError("翻译排队等待超时，已完成分段保留，可稍后继续", "translation_queue_timeout")
                ordered = self._ordered(now)
                # An external transport can cancel without taking our lock,
                # including between the first check and building this list.
                if job_id not in ordered:
                    raise TranslationCancelled()
                if self._active is None and ordered and ordered[0] == job_id:
                    self._active = job_id
                    self._selection_burst = self._selection_burst + 1 if ticket.source == "selection" else 0
                    return
                position = ordered.index(job_id) + 1
                event = None
                if position != previous_position or now - last_update >= 1:
                    event = {"type": "waiting", "job_id": job_id, "request_source": ticket.source,
                             "queue_position": position, "message": f"等待模型处理，当前排队第 {position} 位…"}
                    previous_position, last_update = position, now
                else:
                    # Transport cancellation is an Event supplied by the HTTP
                    # worker, so poll it even without scheduler notifications.
                    self._condition.wait(timeout=0.1)
            if event is not None:
                yield event

    def release(self, job_id: str, *, pending: bool = True) -> None:
        with self._condition:
            if self._active != job_id:
                return
            self._active = None
            ticket = self._tickets[job_id]
            ticket.waiting = pending
            self._sequence += 1
            ticket.sequence = self._sequence
            ticket.waiting_since = self._clock()
            self._condition.notify_all()

    def finish(self, job_id: str) -> None:
        with self._condition:
            if self._active == job_id:
                self._active = None
            self._tickets.pop(job_id, None)
            self._condition.notify_all()

    def shutdown(self) -> None:
        with self._condition:
            self._stopping = True
            for ticket in self._tickets.values():
                ticket.cancel.set()
            self._condition.notify_all()
