#!/bin/sh
set -eu

CHAT_MODEL="${OLLAMA_MODEL:-llama3.2}"
EMBEDDING_MODEL="${OLLAMA_EMBEDDING_MODEL:-nomic-embed-text}"

echo "Starting Ollama server..."
ollama serve &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup INT TERM

echo "Waiting for Ollama to accept requests..."
until ollama list >/dev/null 2>&1; do
  sleep 1
done

pull_if_missing() {
  MODEL="$1"
  if ollama show "$MODEL" >/dev/null 2>&1; then
    echo "Ollama model '$MODEL' is already available."
  else
    echo "Pulling Ollama model '$MODEL'..."
    ollama pull "$MODEL"
  fi
}

pull_if_missing "$CHAT_MODEL"
pull_if_missing "$EMBEDDING_MODEL"

echo "Ollama is ready with chat model '$CHAT_MODEL' and embedding model '$EMBEDDING_MODEL'."
wait "$SERVER_PID"
