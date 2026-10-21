"""Демонстрація двостороннього маршруту без мережі й платних викликів."""

from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

from .core import Budget, Message, MockAdapter, Router


def main() -> None:
    now = datetime.now(timezone.utc).isoformat()
    month = now[:7]
    sha = "a" * 40
    with TemporaryDirectory() as folder:
        claude = MockAdapter("mock-claude", actual_cost_cents=12)
        codex = MockAdapter("mock-codex")
        router = Router(claude=claude, codex=codex,
                        journal=Path(folder) / "events.jsonl", budget=Budget(month))
        common = dict(task_id="T-9000", commit_sha=sha, status="working",
                      at=now, data_class="synthetic", attempt=1)
        first = Message(message_id="M-demo-1", sender="J5", recipient="J3",
                        kind="question", body="Синтетичне запитання про протокол",
                        round=1, step="question", **common)
        second = Message(message_id="M-demo-2", sender="J3", recipient="J5",
                         kind="report", body="Синтетичний звіт про перевірку",
                         round=2, step="report", **common)
        print(router.route(first, max_claude_cost_cents=20)["state"])
        print(router.route(second)["state"])
        print(f"mock deliveries: J3={len(claude.received)}, J5={len(codex.received)}")


if __name__ == "__main__":
    main()
