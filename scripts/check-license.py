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

"""Check that all files matching include patterns have the required license header.

Configuration is read from .license-check.toml in the project root.
To add new file types or directories to check, edit .license-check.toml instead of this script.
"""

import sys
import tomllib
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    config_path = root / ".license-check.toml"

    if not config_path.exists():
        print(f"Error: config file not found: {config_path}")
        sys.exit(1)

    with config_path.open("rb") as f:
        config = tomllib.load(f)

    marker: str = config.get("copyright_marker", "Copyright 2026 Datastrato, Inc.")
    include_patterns: list[str] = config.get("include_patterns", [])
    exclude_patterns: list[str] = config.get("exclude_patterns", [])

    if not include_patterns:
        print("Warning: no include_patterns defined in .license-check.toml, nothing to check.")
        return

    included: set[Path] = set()
    for pattern in include_patterns:
        included.update(root.glob(pattern))

    excluded: set[Path] = set()
    for pattern in exclude_patterns:
        excluded.update(root.glob(pattern))

    files_to_check = sorted(p for p in included - excluded if p.is_file())

    missing: list[Path] = []
    for file_path in files_to_check:
        try:
            content = file_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        if marker not in content:
            missing.append(file_path.relative_to(root))

    if missing:
        print(f"The following {len(missing)} file(s) are missing the license header ({marker!r}):")
        for f in sorted(missing):
            print(f"  {f}")
        sys.exit(1)

    print(f"✓ All {len(files_to_check)} checked files have the required license header.")


if __name__ == "__main__":
    main()
