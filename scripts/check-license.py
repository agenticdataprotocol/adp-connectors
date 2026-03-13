# Copyright 2026 Datastrato, Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Check that covered files contain the required license header."""

from __future__ import annotations

import os
import sys
from pathlib import Path

COPYRIGHT_MARKER = "Copyright 2026 Datastrato, Inc."

SCAN_RULES = [
    {"dirs": ["adp-mcp/src", "adp-mcp/tests", "scripts"], "ext": ".py"},
    {"dirs": [os.path.join(".github", "workflows")], "ext": ".yml"},
]
SCAN_FILES = [Path("CONTRIBUTING.md")]
SKIP_DIRS = {".venv", "dist", "__pycache__", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".worktrees"}


def should_skip_dir(dirname: str) -> bool:
    return dirname in SKIP_DIRS


def collect_files() -> list[Path]:
    files: list[Path] = []
    for rule in SCAN_RULES:
        for base_dir in rule["dirs"]:
            base_path = Path(base_dir)
            if not base_path.exists():
                continue
            for root, dirs, filenames in os.walk(base_path):
                dirs[:] = [d for d in dirs if not should_skip_dir(d)]
                for filename in filenames:
                    if filename.endswith(rule["ext"]):
                        files.append(Path(root) / filename)
    for path in SCAN_FILES:
        if path.exists():
            files.append(path)
    return sorted(files)


def check_header(path: Path) -> bool:
    return COPYRIGHT_MARKER in path.read_text(encoding="utf-8")


def main() -> int:
    files = collect_files()
    missing = [str(path) for path in files if not check_header(path)]
    if missing:
        print("Files missing license header:")
        for path in missing:
            print(f"  {path}")
        print(f"\n{len(missing)} file(s) missing the required license header.")
        return 1
    print(f"All {len(files)} file(s) have the required license header.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
