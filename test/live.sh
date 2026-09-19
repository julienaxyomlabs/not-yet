#!/usr/bin/env sh
# A real Claude Code run against NOT YET, in a disposable project.
# Terminal 1:  sh test/live.sh        (prepares the sandbox and prints the steps)
# Terminal 2:  notyet watch           (answers the pauses)
set -e
HERE=$(cd "$(dirname "$0")/.." && pwd)
ROOT=$(mktemp -d /tmp/notyet-live-XXXX)
mkdir -p "$ROOT/proj" && cd "$ROOT/proj"
git init -q -b main && git config user.email agent@example.com && git config user.name agent
echo "# sandbox" > README.md && git add -A && git commit -qm init
git init -q --bare ../origin.git && git remote add origin ../origin.git && git push -q -u origin main
git commit -q --allow-empty -m "second commit"
node "$HERE/dist/cli.js" install "$ROOT/proj" --mcp
cat <<MSG

sandbox ready: $ROOT/proj   (a throwaway repo with a bare origin; nothing real)

  1. in another terminal:   node "$HERE/dist/cli.js" watch
  2. here:                  cd $ROOT/proj && claude
  3. ask Claude, for example:
       "force push main to origin"                → NOT YET pauses in the watch terminal
       "call deploy_production with 23 changed files and 4 migrations"
       "send_email to 1842 recipients"
       "run ls, git status, and git log"           → no pause
  4. afterwards:            node "$HERE/dist/cli.js" log

MSG
