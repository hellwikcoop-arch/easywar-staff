"""Лише синтетичні сценарії; мережевих викликів немає."""

from datetime import datetime, timezone
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from j4_bridge.core import (
    BridgeError, Budget, Limits, Message, MockAdapter, Router, acceptance_ready,
)


SHA = "a" * 40
OTHER_SHA = "b" * 40
NOW = datetime.now(timezone.utc).isoformat()
MONTH = NOW[:7]


def message(**overrides):
    fields = dict(message_id="M-1", task_id="T-9000", sender="J5", recipient="J3",
                  commit_sha=SHA, kind="question", status="working", at=NOW,
                  body="Синтетичне запитання", data_class="synthetic",
                  round=1, step="question", attempt=1, decision_level=None)
    fields.update(overrides)
    return Message(**fields)


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.journal = Path(self.temp.name) / "events.jsonl"
        self.claude = MockAdapter("mock-claude", 100)
        self.codex = MockAdapter("mock-codex")
        self.budget = Budget(MONTH)
        self.router = Router(claude=self.claude, codex=self.codex,
                             journal=self.journal, budget=self.budget)

    def test_two_way_delivery_and_required_protocol_fields(self):
        self.router.route(message(), max_claude_cost_cents=100)
        self.router.route(message(message_id="M-2", sender="J3", recipient="J5",
                                  kind="report", body="Синтетичний звіт", round=2,
                                  step="report"))
        self.assertEqual((len(self.claude.received), len(self.codex.received)), (1, 1))
        records = [json.loads(line) for line in self.journal.read_text().splitlines()]
        self.assertEqual([r["state"] for r in records], ["delivered", "delivered"])
        for record in records:
            self.assertTrue({"task_id", "sender", "recipient", "commit_sha", "status", "at"}
                            <= record["message"].keys())

    def test_level_c_is_queued_for_je_without_auto_approval(self):
        result = self.router.route(message(kind="decision", decision_level="C",
                                           recipient="JE", body="Збільшити бюджет"))
        self.assertEqual(result["state"], "awaiting_je")
        self.assertEqual(len(self.claude.received), 0)
        self.assertEqual(len(self.codex.received), 0)
        self.assertEqual(self.router.calls, {})
        with self.assertRaises(BridgeError):
            self.router.route(message(message_id="M-2", kind="decision",
                                      decision_level="C", recipient="J3", step="next"))

    def test_budget_warnings_and_hard_stop(self):
        self.budget.spent_cents = 3450
        self.claude.actual_cost_cents = 100
        result = self.router.route(message(), max_claude_cost_cents=100)
        self.assertEqual(result["alerts"], ["warning_35_usd"])
        self.budget.spent_cents = 4450
        self.claude.actual_cost_cents = 100
        result = self.router.route(message(message_id="M-2", body="Наступне питання",
                                           round=2, step="next"), max_claude_cost_cents=100)
        self.assertEqual(result["alerts"], ["critical_45_usd"])
        self.budget.spent_cents = 4950
        with self.assertRaisesRegex(BridgeError, "перевищити"):
            self.router.route(message(message_id="M-3", body="Ще одне питання",
                                      round=3, step="third"), max_claude_cost_cents=100)
        self.assertEqual(len(self.claude.received), 2)
        self.claude.actual_cost_cents = 50
        result = self.router.route(message(message_id="M-4", body="Останнє питання",
                                           round=3, step="last"), max_claude_cost_cents=50)
        self.assertEqual(result["alerts"], ["stop_50_usd"])
        with self.assertRaisesRegex(BridgeError, "вичерпано"):
            self.router.route(message(message_id="M-5", body="Понад ліміт",
                                      round=4, step="extra"), max_claude_cost_cents=1)
        with self.assertRaisesRegex(BridgeError, "зупинено"):
            self.router.route(message(message_id="M-6", sender="J3", recipient="J5",
                                      body="Синтетичний звіт після ліміту", kind="report",
                                      round=4, step="codex"))
        self.assertEqual(len(self.claude.received), 3)
        self.assertEqual(len(self.codex.received), 0)

    def test_rejects_cycle_attempt_and_round_limit(self):
        self.router.route(message(), max_claude_cost_cents=100)
        with self.assertRaisesRegex(BridgeError, "Повторний зміст"):
            self.router.route(message(message_id="M-2", round=2, step="again"),
                              max_claude_cost_cents=100)
        with self.assertRaisesRegex(BridgeError, "третя"):
            self.router.route(message(message_id="M-3", body="Спроба 3", attempt=3,
                                      round=2), max_claude_cost_cents=100)
        with self.assertRaisesRegex(BridgeError, "раундів"):
            self.router.route(message(message_id="M-4", body="Раунд 9", round=9,
                                      step="another"), max_claude_cost_cents=100)

    def test_second_attempt_allowed_third_denied(self):
        self.router.route(message(), max_claude_cost_cents=100)
        self.router.route(message(message_id="M-2", body="Синтетична повторна спроба",
                                  round=2, attempt=2), max_claude_cost_cents=100)
        with self.assertRaisesRegex(BridgeError, "третя"):
            self.router.route(message(message_id="M-3", body="Синтетична третя спроба",
                                      round=3, attempt=3), max_claude_cost_cents=100)

    def test_call_limit_and_restart_replay(self):
        router = Router(claude=self.claude, codex=self.codex, journal=self.journal,
                        budget=self.budget, limits=Limits(max_calls_per_task=1))
        router.route(message(), max_claude_cost_cents=100)
        replay_budget = Budget(MONTH)
        restarted = Router(claude=MockAdapter("mock-claude"),
                           codex=MockAdapter("mock-codex"), journal=self.journal,
                           budget=replay_budget, limits=Limits(max_calls_per_task=1))
        self.assertEqual(replay_budget.spent_cents, 100)
        with self.assertRaisesRegex(BridgeError, "викликів"):
            restarted.route(message(message_id="M-2", body="Синтетичний наступний крок",
                                    round=2, step="next"), max_claude_cost_cents=0)

    def test_mock_cost_must_fit_reservation_before_delivery(self):
        with self.assertRaisesRegex(BridgeError, "перевищує резерв"):
            self.router.route(message(), max_claude_cost_cents=99)
        self.assertEqual(len(self.claude.received), 0)
        self.assertFalse(self.journal.exists())

    def test_rejects_non_synthetic_and_secret_like_text(self):
        for bad in (message(data_class="operational"),
                    message(body="contact@example.org"),
                    message(body="sk-ant-example-secret")):
            with self.assertRaises(BridgeError):
                self.router.route(bad, max_claude_cost_cents=100)
        self.assertFalse(self.journal.exists())

    def test_rejects_bad_sha_or_naive_time(self):
        for bad in (message(commit_sha="abc"), message(at="2026-10-21T10:00:00")):
            with self.assertRaises(BridgeError):
                bad.validate()

    def test_acceptance_requires_independent_same_sha_evidence(self):
        checks = [{"subject": SHA, "passed": True, "evidence_ref": "verify/run-1.log"}]
        reviews = [{"subject": SHA, "by": "C3", "review_status": "complete",
                    "verdict": "passed", "evidence_ref": "review/c3.yaml"}]
        accepts = [{"subject": SHA, "by": "J3", "role": "technical", "evidence_ref": "j3.yaml"},
                   {"subject": SHA, "by": "J5", "role": "content", "evidence_ref": "j5.yaml"}]
        args = dict(commit_sha=SHA, checks=checks, reviews=reviews,
                    acceptances=accepts, open_mandatory_findings=0)
        self.assertTrue(acceptance_ready(**args))
        self.assertFalse(acceptance_ready(**{**args, "commit_sha": OTHER_SHA}))
        self.assertFalse(acceptance_ready(**{**args, "open_mandatory_findings": 1}))
        self.assertFalse(acceptance_ready(**{**args, "key_decision": True}))
        self.assertFalse(acceptance_ready(**{**args, "reviews": [
            {**reviews[0], "review_status": "incomplete", "verdict": None}]}))
        self.assertFalse(acceptance_ready(**{**args, "reviews": reviews + [
            {**reviews[0], "verdict": "changes_requested"}]}))
        self.assertTrue(acceptance_ready(**{**args, "key_decision": True,
            "acceptances": accepts + [{"subject": SHA, "by": "JE",
                                       "role": "key_decision", "evidence_ref": "je.yaml"}]}))


if __name__ == "__main__":
    unittest.main()
