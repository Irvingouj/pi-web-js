#!/usr/bin/env python3
"""Split chrome-passthrough.ts into namespace files under tools/chrome/."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src/main/runner/tools/chrome-passthrough.ts"
OUT = ROOT / "src/main/runner/tools/chrome"

IMPORT_HEADER = '''/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/cross/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";

'''


def find_blocks(text: str) -> list[tuple[str, str]]:
    blocks: list[tuple[str, str]] = []
    i = 0
    while True:
        idx = text.find("registerChromePassthrough(", i)
        if idx == -1:
            break
        action_match = re.search(r'"([^"]+)"', text[idx : idx + 120])
        if not action_match:
            break
        action = action_match.group(1)
        depth = 0
        j = idx + len("registerChromePassthrough(")
        while j < len(text):
            if text[j] == "(":
                depth += 1
            elif text[j] == ")":
                if depth == 0:
                    end = j + 2 if text[j + 1] == ";" else j + 1
                    blocks.append((action, text[idx:end]))
                    i = end
                    break
                depth -= 1
            j += 1
        else:
            break
    return blocks


def namespace_for(action: str) -> str:
    parts = action.split("_")
    if len(parts) < 2:
        return "misc"
    if parts[1] == "system":
        return "system"
    if parts[1] == "tabGroups":
        return "tab-groups"
    if parts[1] == "sidePanel":
        return "side-panel"
    if parts[1] == "contextMenus":
        return "context-menus"
    return parts[1]


def main() -> None:
    text = SRC.read_text()
    blocks = find_blocks(text)
    OUT.mkdir(parents=True, exist_ok=True)
    grouped: dict[str, list[str]] = {}
    for action, block in blocks:
        ns = namespace_for(action)
        grouped.setdefault(ns, []).append(block)

    for ns, items in sorted(grouped.items()):
        body = IMPORT_HEADER + "\n".join(items) + "\n"
        (OUT / f"{ns}.ts").write_text(body)
        print(f"wrote chrome/{ns}.ts ({len(items)} registrations)")

    index_imports = "\n".join(
        f'import "./{ns}.js";' for ns in sorted(grouped)
    )
    index = f"""/// <reference types="chrome" />
// Chrome API passthrough registrations by namespace.

{index_imports}
"""
    (OUT / "index.ts").write_text(index)
    SRC.unlink()
    print("removed chrome-passthrough.ts, wrote chrome/index.ts")


if __name__ == "__main__":
    main()
