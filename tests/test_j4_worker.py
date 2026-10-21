"""Перевірка автоматичної черги і відновлення тільки на синтетичних даних."""

from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from j4_bridge.core import BridgeError, Budget, Message, MockAdapter, Router
from j4_bridge.worker import LocalWorker


NOW = datetime.now(timezone.utc).isoformat()
SHA = "a" * 40


def sample(message_id, sender, recipient, round_number, kind, step, **extra):
    return Message(message_id=message_id, task_id="T-9001", sender=sender,
                   recipient=recipient, commit_sha=SHA, kind=kind, status="working",
                   at=NOW, body=f"Синтетичне повідомлення {message_id}",
                   data_class="synthetic", round=round_number, step=step,
                   attempt=1, **extra)


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.journal = root / "events.jsonl"
        self.database = root / "queue.sqlite3"
        self.question = sample("M-q", "J5", "J3", 1, "question", "question")
        self.report = sample("M-r", "J3", "J5", 2, "report", "report")
        self.decision = sample("M-c", "J5", "JE", 3, "decision", "decision",
                               decision_level="C")

    def router(self, claude=None, codex=None, budget=None):
        return Router(claude=claude or MockAdapter("mock-claude", 12),
                      codex=codex or MockAdapter("mock-codex"),
                      journal=self.journal, budget=budget or Budget(NOW[:7]))

    def test_automatic_three_step_handoff_ends_at_je(self):
        claude = MockAdapter("mock-claude", 12,
                             scripted_replies={self.question.message_id: self.report})
        codex = MockAdapter("mock-codex",
                            scripted_replies={self.report.message_id: self.decision})
        router = self.router(claude, codex)
        with LocalWorker(router=router, database=self.database) as worker:
            worker.enqueue(self.question, max_claude_cost_cents=20)
            self.assertEqual(worker.run(), 3)
            self.assertEqual(worker.states(), [
                ("M-q", "delivered"), ("M-r", "delivered"), ("M-c", "awaiting_je")])
            self.assertEqual(worker.run(), 0)
        self.assertEqual((len(claude.received), len(codex.received)), (1, 1))
        self.assertEqual(router.budget.spent_cents, 12)

    def test_restart_after_claim_retries_only_undelivered_mock(self):
        first_adapter = MockAdapter("mock-claude", 12)
        router = self.router(claude=first_adapter)
        def crash(point, _message_id):
            if point == "after_claim":
                raise RuntimeError("synthetic crash")
        with LocalWorker(router=router, database=self.database, crash_hook=crash) as worker:
            worker.enqueue(self.question, max_claude_cost_cents=20)
            with self.assertRaisesRegex(RuntimeError, "synthetic crash"):
                worker.run()
            self.assertEqual(worker.states(), [("M-q", "in_flight")])
        self.assertEqual(len(first_adapter.received), 0)
        replacement = MockAdapter("mock-claude", 12)
        with LocalWorker(router=self.router(claude=replacement), database=self.database) as worker:
            self.assertEqual(worker.run(), 1)
            self.assertEqual(worker.states(), [("M-q", "delivered")])
        self.assertEqual(len(replacement.received), 1)

    def test_restart_after_journal_does_not_redeliver(self):
        claude = MockAdapter("mock-claude", 12,
                             scripted_replies={self.question.message_id: self.report})
        router = self.router(claude=claude)
        def crash(point, message_id):
            if point == "after_route" and message_id == "M-q":
                raise RuntimeError("synthetic crash")
        with LocalWorker(router=router, database=self.database, crash_hook=crash) as worker:
            worker.enqueue(self.question, max_claude_cost_cents=20)
            with self.assertRaisesRegex(RuntimeError, "synthetic crash"):
                worker.run()
            self.assertEqual(worker.states(), [("M-q", "in_flight")])
        self.assertEqual(len(claude.received), 1)
        replacement = MockAdapter("mock-claude", 12,
                                  scripted_replies={self.question.message_id: self.report})
        codex = MockAdapter("mock-codex")
        restarted = self.router(claude=replacement, codex=codex)
        with LocalWorker(router=restarted, database=self.database) as worker:
            self.assertEqual(worker.run(), 1)
            self.assertEqual(worker.states(), [("M-q", "delivered"), ("M-r", "delivered")])
        self.assertEqual(len(replacement.received), 0)
        self.assertEqual(len(codex.received), 1)
        self.assertEqual(restarted.budget.spent_cents, 12)

    def test_budget_stop_blocks_models_but_preserves_je_queue(self):
        claude = MockAdapter("mock-claude", 12)
        router = self.router(claude=claude, budget=Budget(NOW[:7], spent_cents=5000))
        with LocalWorker(router=router, database=self.database) as worker:
            worker.enqueue(self.question, max_claude_cost_cents=20)
            worker.enqueue(replace(self.decision, round=1))
            self.assertEqual(worker.run(), 1)
            self.assertEqual(worker.states(), [("M-q", "blocked"), ("M-c", "awaiting_je")])
        self.assertEqual(len(claude.received), 0)

    def test_duplicate_id_cannot_change_payload(self):
        with LocalWorker(router=self.router(), database=self.database) as worker:
            worker.enqueue(self.question, max_claude_cost_cents=20)
            worker.enqueue(self.question, max_claude_cost_cents=20)
            with self.assertRaisesRegex(BridgeError, "ID вже"):
                worker.enqueue(replace(self.report, message_id="M-q"))
            self.assertEqual(worker.states(), [("M-q", "queued")])

    def test_corrupt_journal_fails_closed_on_restart(self):
        self.journal.write_text('{"message":', encoding="utf-8")
        with self.assertRaisesRegex(BridgeError, "Журнал пошкоджено"):
            self.router()

    def test_automatic_reply_chain_stops_at_round_limit(self):
        chain = [sample(f"M-loop-{n}", "J5" if n % 2 else "J3",
                        "J3" if n % 2 else "J5", n, "question", f"step-{n}")
                 for n in range(1, 10)]
        claude_scripts = {}
        codex_scripts = {}
        for current, following in zip(chain, chain[1:]):
            target = claude_scripts if current.recipient == "J3" else codex_scripts
            target[current.message_id] = following
        router = self.router(claude=MockAdapter("mock-claude", 0,
                                               scripted_replies=claude_scripts),
                             codex=MockAdapter("mock-codex",
                                               scripted_replies=codex_scripts))
        with LocalWorker(router=router, database=self.database) as worker:
            worker.enqueue(chain[0])
            self.assertEqual(worker.run(), 8)
            self.assertEqual(worker.states()[-1], ("M-loop-9", "blocked"))
            self.assertEqual(worker.run(), 0)


if __name__ == "__main__":
    unittest.main()
