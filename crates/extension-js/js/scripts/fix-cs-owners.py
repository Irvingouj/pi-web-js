#!/usr/bin/env python3
"""Convert content-script DOM actions from registerJsCall to registerContentScriptJsCall."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

CS_ACTIONS = {
    "page_url",
    "page_title",
    "page_click",
    "page_fill",
    "page_type",
    "page_append",
    "page_press",
    "page_select",
    "page_check",
    "page_hover",
    "page_unhover",
    "page_scroll",
    "page_scroll_to",
    "page_dblclick",
    "page_back",
    "tab_click",
    "tab_fill",
    "tab_type",
    "tab_press",
    "tab_select",
    "tab_check",
    "tab_hover",
    "tab_unhover",
    "tab_scroll",
    "tab_scroll_to",
    "tab_dblclick",
    "tab_back",
}


def find_block_end(text: str, start: int) -> int:
    depth = 0
    i = start
    while i < len(text):
        ch = text[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                # include trailing );
                j = i + 1
                while j < len(text) and text[j] in " \t\n":
                    j += 1
                if text[j : j + 2] == ");":
                    return j + 2
                return i + 1
        i += 1
    raise ValueError("unbalanced braces")


def strip_handler(block: str) -> str:
    match = re.search(r"\n\thandler:\s*async\b", block)
    if not match:
        return block
    handler_start = match.start()
    # find handler value end at same indent as handler key
    depth = 0
    i = match.end()
    # skip to opening paren or brace of async function
    while i < len(block) and block[i] not in "{(":
        i += 1
    if i >= len(block):
        return block
    if block[i] == "(":
        # arrow with parens - find matching )
        depth = 1
        i += 1
        while i < len(block) and depth:
            if block[i] == "(":
                depth += 1
            elif block[i] == ")":
                depth -= 1
            i += 1
        # skip optional => { ... }
        while i < len(block) and block[i] in " \t\n":
            i += 1
        if block[i : i + 2] == "=>":
            i += 2
            while i < len(block) and block[i] in " \t\n":
                i += 1
    if i < len(block) and block[i] == "{":
        depth = 1
        i += 1
        while i < len(block) and depth:
            if block[i] == "{":
                depth += 1
            elif block[i] == "}":
                depth -= 1
            i += 1
    # remove trailing comma before next field or closing
    end = i
    while end < len(block) and block[end] in " \t\n":
        end += 1
    if end < len(block) and block[end] == ",":
        end += 1
    return block[:handler_start] + block[end:]


def transform_file(path: Path) -> None:
    text = path.read_text()
    out: list[str] = []
    i = 0
    changed = 0
    while True:
        idx = text.find("registerJsCall({", i)
        if idx == -1:
            out.append(text[i:])
            break
        out.append(text[i:idx])
        block_start = idx
        brace = text.index("{", idx)
        block_end = find_block_end(text, brace)
        block = text[block_start:block_end]
        action_match = re.search(r'action:\s*"([^"]+)"', block)
        if action_match and action_match.group(1) in CS_ACTIONS:
            block = block.replace("registerJsCall({", "registerContentScriptJsCall({", 1)
            block = strip_handler(block)
            block = re.sub(r'\n\towner:\s*"main-thread",\n', "\n", block)
            changed += 1
        out.append(block)
        i = block_end
    new_text = "".join(out)
    if "registerContentScriptJsCall" in new_text and "registerContentScriptJsCall" not in path.read_text():
        new_text = new_text.replace(
            "registerJsCall,\n",
            "registerJsCall,\n\tregisterContentScriptJsCall,\n",
            1,
        )
    path.write_text(new_text)
    print(f"{path.name}: converted {changed} blocks")


def main() -> None:
    transform_file(ROOT / "src/main/runner/tools/page.ts")
    transform_file(ROOT / "src/main/runner/tools/tab.ts")


if __name__ == "__main__":
    main()
