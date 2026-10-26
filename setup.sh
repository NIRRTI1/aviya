#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
python3 -m venv "$ROOT/backend/.venv"
"$ROOT/backend/.venv/bin/pip" install -r "$ROOT/backend/requirements.txt"
(cd "$ROOT/frontend" && npm install)
echo "Setup complete. Run Ollama, then start API and UI as described in README.md."
