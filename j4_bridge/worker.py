"""Стійка локальна черга для автоматичного синтетичного обміну J3↔J5."""

from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path
import sqlite3
from typing import Callable

from .core import BridgeError, Message, Router


class LocalWorker:
    """Один локальний процес; після збою звіряє чергу з журналом Router."""

    def __init__(self, *, router: Router, database: Path,
                 crash_hook: Callable[[str, str], None] | None = None):
        self.router = router
        self.crash_hook = crash_hook
        database.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(database)
        self.db.execute("PRAGMA busy_timeout = 5000")
        self.db.execute("PRAGMA synchronous = FULL")
        self.db.execute("""CREATE TABLE IF NOT EXISTS outbox (
            message_id TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            max_claude_cost_cents INTEGER NOT NULL,
            state TEXT NOT NULL CHECK (state IN
                ('queued', 'in_flight', 'delivered', 'awaiting_je', 'blocked')),
            result TEXT,
            error TEXT
        )""")
        self.db.commit()

    def close(self) -> None:
        self.db.close()

    def __enter__(self) -> LocalWorker:
        return self

    def __exit__(self, *_unused: object) -> None:
        self.close()

    def enqueue(self, message: Message, *, max_claude_cost_cents: int = 0) -> None:
        message.validate()
        if not isinstance(max_claude_cost_cents, int) or max_claude_cost_cents < 0:
            raise BridgeError("Неправильний резерв Claude")
        payload = json.dumps(asdict(message), ensure_ascii=False, sort_keys=True)
        with self.db:
            row = self.db.execute(
                "SELECT payload, max_claude_cost_cents FROM outbox WHERE message_id = ?",
                (message.message_id,)).fetchone()
            if row:
                if row != (payload, max_claude_cost_cents):
                    raise BridgeError("ID вже використано для іншого повідомлення")
                return
            self.db.execute(
                "INSERT INTO outbox (message_id, payload, max_claude_cost_cents, state) "
                "VALUES (?, ?, ?, 'queued')",
                (message.message_id, payload, max_claude_cost_cents))

    def _reply(self, message: Message) -> Message | None:
        if message.recipient == "JE":
            return None
        reply = self.router.adapters[message.recipient].scripted_replies.get(message.message_id)
        if reply is None:
            return None
        reply.validate()
        if (reply.sender != message.recipient or reply.task_id != message.task_id
                or reply.commit_sha != message.commit_sha or reply.round != message.round + 1):
            raise BridgeError("Тестова відповідь порушує маршрут або версію")
        return reply

    def _finish(self, message: Message, result: dict) -> None:
        reply = self._reply(message)
        with self.db:
            self.db.execute(
                "UPDATE outbox SET state = ?, result = ?, error = NULL "
                "WHERE message_id = ? AND state = 'in_flight'",
                (result["state"], json.dumps(result, ensure_ascii=False, sort_keys=True),
                 message.message_id))
            if reply is not None:
                payload = json.dumps(asdict(reply), ensure_ascii=False, sort_keys=True)
                reserve = self.router.adapters["J3"].actual_cost_cents if reply.recipient == "J3" else 0
                row = self.db.execute(
                    "SELECT payload, max_claude_cost_cents FROM outbox WHERE message_id = ?",
                    (reply.message_id,)).fetchone()
                if row and row != (payload, reserve):
                    raise BridgeError("ID тестової відповіді вже використано")
                if not row:
                    self.db.execute(
                        "INSERT INTO outbox (message_id, payload, max_claude_cost_cents, state) "
                        "VALUES (?, ?, ?, 'queued')", (reply.message_id, payload, reserve))

    def recover(self) -> None:
        """Доставлене у журналі завершити; недоставлене mock-повідомлення повторити."""
        rows = self.db.execute(
            "SELECT payload FROM outbox WHERE state = 'in_flight' ORDER BY rowid").fetchall()
        for (payload,) in rows:
            message = Message(**json.loads(payload))
            result = self.router.records.get(message.message_id)
            if result is not None:
                self._finish(message, result)
            else:
                with self.db:
                    self.db.execute("UPDATE outbox SET state = 'queued' WHERE message_id = ?",
                                    (message.message_id,))

    def run(self, *, max_dispatches: int = 100) -> int:
        if max_dispatches < 1:
            raise BridgeError("Потрібен додатний ліміт доставок")
        self.recover()
        dispatched = 0
        while dispatched < max_dispatches:
            row = self.db.execute(
                "SELECT message_id, payload, max_claude_cost_cents FROM outbox "
                "WHERE state = 'queued' ORDER BY rowid LIMIT 1").fetchone()
            if row is None:
                return dispatched
            message_id, payload, reserve = row
            message = Message(**json.loads(payload))
            with self.db:
                self.db.execute(
                    "UPDATE outbox SET state = 'in_flight' WHERE message_id = ? AND state = 'queued'",
                    (message_id,))
            if self.crash_hook:
                self.crash_hook("after_claim", message_id)
            try:
                result = self.router.route(message, max_claude_cost_cents=reserve)
            except BridgeError as exc:
                with self.db:
                    self.db.execute(
                        "UPDATE outbox SET state = 'blocked', error = ? WHERE message_id = ?",
                        (str(exc), message_id))
                continue
            if self.crash_hook:
                self.crash_hook("after_route", message_id)
            self._finish(message, result)
            dispatched += 1
        if self.db.execute("SELECT 1 FROM outbox WHERE state = 'queued' LIMIT 1").fetchone():
            raise BridgeError("Ліміт доставок за запуск вичерпано")
        return dispatched

    def states(self) -> list[tuple[str, str]]:
        return self.db.execute(
            "SELECT message_id, state FROM outbox ORDER BY rowid").fetchall()
