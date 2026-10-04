from app.ai.provider import LLMReply, StreamPart, ToolDecl, Turn


class FakeProvider:
    """Scripted LLMProvider: each generate() pops the next LLMReply (or raises an Exception)."""

    def __init__(self, script: list[LLMReply | Exception] | None = None, json_result=None,
                 stream_script: list[list[StreamPart | Exception]] | None = None):
        self.script = list(script or [])
        self.stream_script = list(stream_script or [])
        self.json_result = json_result
        self.calls: list[dict] = []

    def generate(self, system: str, turns: list[Turn], tools: list[ToolDecl],
                 timeout: float | None = None) -> LLMReply:
        self.calls.append({"kind": "generate", "system": system, "turns": list(turns), "tools": list(tools),
                           "timeout": timeout})
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def stream(self, system: str, turns: list[Turn], tools: list[ToolDecl], timeout: float | None = None):
        """Each stream() call plays the next list: parts are yielded in order, an Exception item is raised there."""
        self.calls.append({"kind": "stream", "system": system, "turns": list(turns), "tools": list(tools),
                           "timeout": timeout})
        for item in self.stream_script.pop(0):
            if isinstance(item, Exception):
                raise item
            yield item

    def generate_json(self, system: str, prompt: str, schema: dict, timeout: float | None = None):
        self.calls.append({"kind": "json", "system": system, "prompt": prompt, "schema": schema, "timeout": timeout})
        if isinstance(self.json_result, Exception):
            raise self.json_result
        return self.json_result
