#!/usr/bin/env python3
"""Split runtime.ts into focused modules under src/main/runner/ (by line range).

Tools are registered separately under tools/ and tools/chrome/.
Use scripts/split-runtime.py for the current runtime decomposition.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "src/main/runner/runtime.ts"
OUT = ROOT / "src/main/runner"

# Historical reference ranges — use split-runtime.py for live splits.
RANGES: list[tuple[str, int, int]] = []
