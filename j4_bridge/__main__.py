"""Автоматичний синтетичний обмін без мережі й платних викликів."""

from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

from .core import Budget, Message, MockAdapter, Router
from .worker import LocalWorker


def main() -> None:
    now = datetime.now(timezone.utc).isoformat()
    sha = "a" * 40
    common = dict(task_id="T-9000", commit_sha=sha, status="working",
                  at=now, data_class="synthetic", attempt=1)
    question = Message(message_id="M-demo-1", sender="J5", recipient="J3",
                       kind="question", body="Синтетичне запитання про протокол",
                       round=1, step="question", **common)
    report = Message(message_id="M-demo-2", sender="J3", recipient="J5",
                     kind="report", body="Синтетичний звіт про перевірку",
                     round=2, step="report", **common)
    decision = Message(message_id="M-demo-3", sender="J5", recipient="JE",
                       kind="decision", body="Синтетичне рішення рівня C",
                       decision_level="C", round=3, step="decision", **common)
    claude = MockAdapter("mock-claude", actual_cost_cents=12,
                         scripted_replies={question.message_id: report})
    codex = MockAdapter("mock-codex", scripted_replies={report.message_id: decision})
    with TemporaryDirectory() as folder:
        root = Path(folder)
        router = Router(claude=claude, codex=codex,
                        journal=root / "events.jsonl", budget=Budget(now[:7]))
        with LocalWorker(router=router, database=root / "queue.sqlite3") as worker:
            worker.enqueue(question, max_claude_cost_cents=20)
            worker.run()
            print(worker.states())
            print(f"mock deliveries: J3={len(claude.received)}, J5={len(codex.received)}")
            print(f"Claude mock cost: ${router.budget.spent_cents / 100:.2f}")


if __name__ == "__main__":
    main()
