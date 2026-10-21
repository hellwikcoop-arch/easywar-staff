"""Локальний синтетичний прототип маршрутизації штабу; живих адаптерів немає."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import re
from typing import ClassVar, Protocol


TASK_ID = re.compile(r"T-[0-9]{4,}")
COMMIT = re.compile(r"[0-9a-f]{40}")
MESSAGE_ID = re.compile(r"M-[A-Za-z0-9_-]{1,48}")
ROLES = {"JE", "J3", "J5", "C3", "C5.1", "C5.4", "ADM"}
KINDS = {"task", "question", "decision", "report"}
STATUSES = {"queued", "working", "waiting", "review", "blocked", "done", "failed"}
SENSITIVE = re.compile(
    r"(?:sk-ant-|sk-proj-|ghp_|github_pat_|AKIA[0-9A-Z]{16}|"
    r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})",
    re.IGNORECASE,
)


class BridgeError(ValueError):
    """Повідомлення або виклик відхилено без доставки."""


def utc_month(at: str) -> str:
    try:
        parsed = datetime.fromisoformat(at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise BridgeError("Неправильний час ISO 8601") from exc
    if parsed.tzinfo is None:
        raise BridgeError("Час має містити часовий пояс")
    return parsed.astimezone(timezone.utc).strftime("%Y-%m")


@dataclass(frozen=True)
class Message:
    message_id: str
    task_id: str
    sender: str
    recipient: str
    commit_sha: str
    kind: str
    status: str
    at: str
    body: str
    data_class: str
    round: int
    step: str
    attempt: int
    decision_level: str | None = None

    def validate(self) -> None:
        if not MESSAGE_ID.fullmatch(self.message_id) or not TASK_ID.fullmatch(self.task_id):
            raise BridgeError("Неправильний ID повідомлення або задачі")
        if self.sender not in ROLES or self.recipient not in ROLES:
            raise BridgeError("Невідома роль")
        if not COMMIT.fullmatch(self.commit_sha):
            raise BridgeError("Потрібен повний 40-символьний SHA коміту")
        if self.kind not in KINDS or self.status not in STATUSES:
            raise BridgeError("Неправильний тип або статус")
        if self.status == "done":
            raise BridgeError("Стан done встановлює лише ADM після незалежного приймання")
        utc_month(self.at)
        if self.data_class != "synthetic":
            raise BridgeError("Дозволено лише synthetic")
        if not isinstance(self.body, str) or not 1 <= len(self.body) <= 2000:
            raise BridgeError("Текст має бути від 1 до 2000 символів")
        if SENSITIVE.search(self.body):
            raise BridgeError("Виявлено схожі на секрет або персональні дані")
        if not isinstance(self.round, int) or isinstance(self.round, bool) or self.round < 1:
            raise BridgeError("Неправильний номер раунду")
        if not re.fullmatch(r"[a-z0-9_-]{1,40}", self.step):
            raise BridgeError("Неправильний крок")
        if not isinstance(self.attempt, int) or isinstance(self.attempt, bool) or self.attempt < 1:
            raise BridgeError("Неправильний номер спроби")
        if self.decision_level not in {None, "A", "B", "C"}:
            raise BridgeError("Неправильний рівень рішення")
        if self.kind == "decision" and self.decision_level is None:
            raise BridgeError("Рішенню потрібен рівень")
        if self.decision_level == "C" and self.recipient != "JE":
            raise BridgeError("Рішення рівня C направляється лише JE")
        if self.recipient == "JE" and self.decision_level != "C":
            raise BridgeError("Канал JE зарезервований для рішень рівня C")
        if self.recipient == "JE" and self.sender == "JE":
            raise BridgeError("Власні рішення JE не приймаються через цю чергу")
        if self.recipient in {"J3", "J5"} and self.sender not in {"J3", "J5"}:
            raise BridgeError("Дозволено лише горизонтальний маршрут J3↔J5")
        if self.recipient in {"J3", "J5"} and self.sender == self.recipient:
            raise BridgeError("Самопередача заборонена")
        if self.recipient not in {"J3", "J5", "JE"}:
            raise BridgeError("Маршрут не підтримується прототипом")


@dataclass(frozen=True)
class Delivery:
    adapter: str
    actual_cost_cents: int = 0
    evidence_ref: str = "synthetic-mock"


class Adapter(Protocol):
    def send(self, message: Message) -> Delivery: ...


@dataclass
class MockAdapter:
    name: str
    actual_cost_cents: int = 0
    received: list[Message] = field(default_factory=list)
    scripted_replies: dict[str, Message] = field(default_factory=dict)

    def send(self, message: Message) -> Delivery:
        self.received.append(message)
        return Delivery(self.name, self.actual_cost_cents)


@dataclass
class Budget:
    month: str
    spent_cents: int = 0
    limit_cents: ClassVar[int] = 5000
    warning_cents: ClassVar[int] = 3500
    critical_cents: ClassVar[int] = 4500

    def __post_init__(self) -> None:
        if not re.fullmatch(r"[0-9]{4}-(0[1-9]|1[0-2])", self.month):
            raise BridgeError("Неправильний бюджетний місяць")
        if not isinstance(self.spent_cents, int) or not 0 <= self.spent_cents <= self.limit_cents:
            raise BridgeError("Неправильний початковий баланс")

    def reserve_check(self, upper_bound_cents: int) -> None:
        if not isinstance(upper_bound_cents, int) or upper_bound_cents < 0:
            raise BridgeError("Потрібна невід'ємна верхня межа витрат")
        if self.spent_cents >= self.limit_cents:
            raise BridgeError("Місячний ліміт Claude API $50 вичерпано")
        if self.spent_cents + upper_bound_cents > self.limit_cents:
            raise BridgeError("Виклик може перевищити місячний ліміт Claude API $50")

    def record(self, actual_cents: int, upper_bound_cents: int) -> list[str]:
        if not isinstance(actual_cents, int) or not 0 <= actual_cents <= upper_bound_cents:
            raise BridgeError("Фактична вартість поза резервом")
        self.spent_cents += actual_cents
        if self.spent_cents >= self.limit_cents:
            return ["stop_50_usd"]
        if self.spent_cents >= self.critical_cents:
            return ["critical_45_usd"]
        if self.spent_cents >= self.warning_cents:
            return ["warning_35_usd"]
        return []


@dataclass(frozen=True)
class Limits:
    max_rounds: int = 8
    max_attempts: int = 2
    max_calls_per_task: int = 40


class Router:
    """Однопроцесний оркестратор; стан живе в пам'яті та локальному журналі."""

    def __init__(self, *, claude: Adapter, codex: Adapter, journal: Path,
                 budget: Budget, limits: Limits = Limits()):
        if type(claude) is not MockAdapter or type(codex) is not MockAdapter:
            raise BridgeError("Етап 1 допускає лише MockAdapter")
        self.adapters = {"J3": claude, "J5": codex}
        self.journal = journal
        self.budget = budget
        self.limits = limits
        self.seen_ids: set[str] = set()
        self.records: dict[str, dict] = {}
        self.fingerprints: set[str] = set()
        self.calls: dict[str, int] = {}
        self.attempts: dict[tuple[str, str], int] = {}
        self.rounds: dict[str, int] = {}
        if journal.exists():
            for line in journal.read_text(encoding="utf-8").splitlines():
                try:
                    record = json.loads(line)
                    old = Message(**record["message"])
                    old.validate()
                    cost = record["delivery"]["actual_cost_cents"]
                    if not isinstance(cost, int) or cost < 0:
                        raise ValueError("cost")
                except (ValueError, KeyError, TypeError) as exc:
                    raise BridgeError("Журнал пошкоджено; автоматичне відновлення зупинено") from exc
                if utc_month(old.at) != budget.month or old.message_id in self.seen_ids:
                    raise BridgeError("Журнал містить інший місяць або повторний ID")
                self.seen_ids.add(old.message_id)
                self.records[old.message_id] = record
                self.fingerprints.add(self._fingerprint(old))
                key = (old.task_id, old.step)
                self.attempts[key] = max(self.attempts.get(key, 0), old.attempt)
                self.rounds[old.task_id] = max(self.rounds.get(old.task_id, 0), old.round)
                if old.recipient != "JE":
                    self.calls[old.task_id] = self.calls.get(old.task_id, 0) + 1
                if old.recipient == "J3":
                    budget.spent_cents += cost
            if budget.spent_cents > budget.limit_cents:
                raise BridgeError("Журнал перевищує бюджет Claude")

    @staticmethod
    def _fingerprint(message: Message) -> str:
        return sha256(json.dumps(
            [message.task_id, message.sender, message.recipient, message.kind,
             message.commit_sha, message.body], ensure_ascii=False).encode()).hexdigest()

    def route(self, message: Message, *, max_claude_cost_cents: int = 0) -> dict:
        message.validate()
        if utc_month(message.at) != self.budget.month:
            raise BridgeError("Місяць повідомлення не збігається з бюджетним")
        if message.message_id in self.seen_ids:
            raise BridgeError("Повторний ID повідомлення")
        fingerprint = self._fingerprint(message)
        if fingerprint in self.fingerprints:
            raise BridgeError("Повторний зміст: можливий цикл")
        if message.round > self.limits.max_rounds:
            raise BridgeError("Ліміт раундів вичерпано")
        previous_round = self.rounds.get(message.task_id, 0)
        if message.round < previous_round or message.round > previous_round + 1:
            raise BridgeError("Порушено послідовність раундів")
        key = (message.task_id, message.step)
        used_attempts = self.attempts.get(key, 0)
        if message.attempt != used_attempts + 1 or message.attempt > self.limits.max_attempts:
            raise BridgeError("Ліміт або послідовність спроб порушено; третя потребує JE")
        calls = self.calls.get(message.task_id, 0)
        if message.recipient != "JE" and self.budget.spent_cents >= self.budget.limit_cents:
            raise BridgeError("Місячний ліміт Claude API $50 вичерпано; нові виклики J4 зупинено")
        if message.recipient != "JE" and calls >= self.limits.max_calls_per_task:
            raise BridgeError("Ліміт викликів задачі вичерпано")
        if message.recipient == "J3":
            self.budget.reserve_check(max_claude_cost_cents)
            if self.adapters["J3"].actual_cost_cents > max_claude_cost_cents:
                raise BridgeError("Вартість mock-виклику перевищує резерв")
        elif max_claude_cost_cents:
            raise BridgeError("Резерв Claude можливий лише для J3")
        if message.recipient == "JE":
            delivery = Delivery("je-queue", 0, "awaiting-je")
            alerts: list[str] = []
            state = "awaiting_je"
        else:
            delivery = self.adapters[message.recipient].send(message)
            if not isinstance(delivery.actual_cost_cents, int) or delivery.actual_cost_cents < 0:
                raise BridgeError("Адаптер повернув неправильну вартість")
            if message.recipient == "J3":
                alerts = self.budget.record(delivery.actual_cost_cents, max_claude_cost_cents)
            elif delivery.actual_cost_cents:
                raise BridgeError("Адаптер Codex не може списувати бюджет Claude")
            else:
                alerts = []
            state = "delivered"
        record = {"message": asdict(message), "delivery": asdict(delivery),
                  "state": state, "alerts": alerts}
        self.journal.parent.mkdir(parents=True, exist_ok=True)
        with self.journal.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        self.seen_ids.add(message.message_id)
        self.records[message.message_id] = record
        self.fingerprints.add(fingerprint)
        self.attempts[key] = message.attempt
        self.rounds[message.task_id] = message.round
        if message.recipient != "JE":
            self.calls[message.task_id] = calls + 1
        return record


def acceptance_ready(*, commit_sha: str, checks: list[dict], reviews: list[dict],
                     acceptances: list[dict], open_mandatory_findings: int,
                     key_decision: bool = False) -> bool:
    """Незалежний технічний і змістовий бар'єр для одного SHA."""
    if not COMMIT.fullmatch(commit_sha) or open_mandatory_findings != 0:
        return False
    if not checks or not all(x.get("subject") == commit_sha and x.get("passed") is True
                             and x.get("evidence_ref") for x in checks):
        return False
    relevant = [x for x in reviews if x.get("subject") == commit_sha and x.get("by") == "C3"]
    if not relevant or relevant[-1].get("review_status") != "complete" \
            or relevant[-1].get("verdict") != "passed" or not relevant[-1].get("evidence_ref"):
        return False
    required = {("J3", "technical"), ("J5", "content")}
    if key_decision:
        required.add(("JE", "key_decision"))
    present = {(x.get("by"), x.get("role")) for x in acceptances
               if x.get("subject") == commit_sha and x.get("evidence_ref")}
    return required <= present
