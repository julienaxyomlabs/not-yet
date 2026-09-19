#!/usr/bin/env sh
# One command: build, then the live validation against the real Claude Code hook.
cd "$(dirname "$0")/.." && npm run live:test
