from dataclasses import dataclass, field
from typing import Literal, Protocol


class AIError(Exception):
    pass


class AIRateLimited(AIError):
    pass


class AIUnavailable(AIError):
    pass


@dataclass
class ToolDecl:
    name: str
    description: str
    parameters: dict


@dataclass
class FunctionCall:
    name: str
    args: dict
    id: str | None = None


@dataclass
class Turn:
    role: Literal["user", "model", "tool"]
    text: str | None = None
    calls: list[FunctionCall] = field(default_factory=list)
    tool_name: str | None = None
    tool_result: dict | None = None
    # a "tool" turn carries every result of one model turn, in call order
    results: list[tuple[str, dict]] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.role == "tool":
            if not self.results and self.tool_name is not None:
                self.results = [(self.tool_name, self.tool_result or {})]
            if self.results and self.tool_name is None:
                self.tool_name, self.tool_result = self.results[0]


@dataclass
class LLMReply:
    text: str | None
    calls: list[FunctionCall] = field(default_factory=list)


class LLMProvider(Protocol):
    def generate(self, system: str, turns: list[Turn], tools: list[ToolDecl],
                 timeout: float | None = None) -> LLMReply: ...

    def generate_json(self, system: str, prompt: str, schema: dict, timeout: float | None = None) -> dict | list: ...
