#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
echo "Start the API in one terminal: cd '$ROOT/backend' && uvicorn app.main:app --reload --port 8000"
echo "Start the UI in another: cd '$ROOT/frontend' && npm install && npm run dev"
echo "Ollama: ollama serve && ollama pull llama3.2:1b"
