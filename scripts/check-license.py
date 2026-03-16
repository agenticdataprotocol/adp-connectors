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

"""Check that every file has the required license header.

All files are included by default (RAT philosophy); only exclusion patterns are configurable.
Configuration is read from .license-check.toml in the project root.
"""

import sys
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:
    try:
        import tomli as tomllib  # type: ignore[no-redef]
    except ModuleNotFoundError:
        print("Error: requires Python 3.11+ (built-in tomllib) or install 'tomli' via: pip install tomli")
        sys.exit(1)


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    config_path = root / ".license-check.toml"

    if not config_path.exists():
        print(f"Error: config file not found: {config_path}")
        sys.exit(1)

    with config_path.open("rb") as f:
        try:
            config = tomllib.load(f)
        except tomllib.TOMLDecodeError as e:
            print(f"Error: failed to parse {config_path}: {e}")
            sys.exit(1)

    marker: str = config.get("copyright_marker", "Copyright 2026 Datastrato, Inc.")
    exclude_patterns: list[str] = config.get("exclude_patterns", [])

    if not isinstance(marker, str):
        print(f"Error: 'copyright_marker' must be a string in {config_path}")
        sys.exit(1)

    if not isinstance(exclude_patterns, list) or not all(isinstance(p, str) for p in exclude_patterns):
        print(f"Error: 'exclude_patterns' must be a list of strings in {config_path}")
        sys.exit(1)

    # Include all files by default (RAT philosophy)
    included: set[Path] = set(root.glob("**/*"))

    excluded: set[Path] = set()
    for pattern in exclude_patterns:
        excluded.update(root.glob(pattern))

    files_to_check = sorted(p for p in included - excluded if p.is_file() and not p.is_symlink())

    missing: list[Path] = []
    for file_path in files_to_check:
        try:
            content = file_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            print(f"Warning: skipping non-UTF-8 file: {file_path.relative_to(root)}")
            continue
        except OSError as e:
            print(f"Warning: skipping unreadable file: {file_path.relative_to(root)} ({e})")
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
