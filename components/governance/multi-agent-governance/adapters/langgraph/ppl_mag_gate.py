"""Thin LangGraph-friendly client for the PPL MAG Node CLI.

It deliberately does not duplicate governance logic in Python. The canonical
policy engine stays in @ppl/multi-agent-governance; Python calls it through a
JSON subprocess boundary so LangGraph/ADK/other runtimes can share one contract.
"""
from __future__ import annotations
import json
import subprocess
from pathlib import Path
from typing import Any, Dict

class PPLMAGGate:
    def __init__(self, cli: str = "ppl-mag") -> None:
        self.cli = cli

    def call(self, command: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        proc = subprocess.run(
            [self.cli, command],
            input=json.dumps(payload),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"PPL MAG {command} failed: {proc.stderr.strip()}")
        return json.loads(proc.stdout)

    def governed_handoff(self, contracts: list[dict], request: dict) -> dict:
        return self.call("governed-handoff", {"contracts": contracts, "request": request})

    def fidelity(self, handoff: dict, received_context: dict, received_task: dict) -> dict:
        return self.call("fidelity", {"handoff": handoff, "receivedContext": received_context, "receivedTask": received_task})
