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


@dataclass
class LLMReply:
    text: str | None
    calls: list[FunctionCall] = field(default_factory=list)


class LLMProvider(Protocol):
    def generate(self, system: str, turns: list[Turn], tools: list[ToolDecl]) -> LLMReply: ...

    def generate_json(self, system: str, prompt: str, schema: dict) -> dict | list: ...
