<!--
Copyright 2026 Datastrato, Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->

# Contributing to ADP Connectors

Thank you for your interest in contributing to ADP Connectors.

## How to Contribute

1. Fork the repository and create your branch from `main`.
2. Keep changes scoped to a single concern. Use stacked pull requests for dependent changes when appropriate.
3. Run checks relevant to the sub-project you touched before opening a pull request.
4. Ensure required license headers are present in covered files.
5. Submit a pull request with a clear description of the change and link the related issue.

## Development Checks

For `adp-mcp`, run the following commands from `adp-mcp/`:

```bash
uv sync --extra dev
uv run ruff check .
uv run black --check .
uv run mypy src/
uv run python -m unittest discover -s tests -v
```

To verify repository-wide license headers, run the following command from the repository root:

```bash
python scripts/check-license.py
```

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).

## License Header Policy

The repository requires Apache 2.0 license headers in:
- Python source files
- Python test files
- repository scripts written in Python
- GitHub Actions workflow YAML files
- `CONTRIBUTING.md`
