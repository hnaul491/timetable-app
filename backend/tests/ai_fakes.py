from app.ai.provider import LLMReply, ToolDecl, Turn


class FakeProvider:
    """Scripted LLMProvider: each generate() pops the next LLMReply (or raises an Exception)."""

    def __init__(self, script: list[LLMReply | Exception] | None = None, json_result=None):
        self.script = list(script or [])
        self.json_result = json_result
        self.calls: list[dict] = []

    def generate(self, system: str, turns: list[Turn], tools: list[ToolDecl]) -> LLMReply:
        self.calls.append({"kind": "generate", "system": system, "turns": list(turns), "tools": list(tools)})
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def generate_json(self, system: str, prompt: str, schema: dict):
        self.calls.append({"kind": "json", "system": system, "prompt": prompt, "schema": schema})
        if isinstance(self.json_result, Exception):
            raise self.json_result
        return self.json_result
