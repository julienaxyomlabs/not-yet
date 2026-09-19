# NOT YET — demo recording notes

## What these clips are
Real captures of the validated V1 interception, rendered to video. Not simulated.

Each clip is produced in two steps:

1. `node demo/scenario.mjs force`  (or `email`)
   Creates a fresh disposable git sandbox under the OS temp dir, with a **local bare `origin`** (never a network remote) and the **real** NOT YET Claude Code hooks installed. Runs a real `claude -p` agent. The agent really runs `node test.mjs` / `node build.mjs`, then really proposes `git push --force origin main` (or the `send_email` MCP tool). The **real installed PreToolUse hook** parks the call; the scenario renders the pause from the **real** policy result + context and rejects it through the **real** `writeDecision` watcher path. It then asserts the push never executed / no email was sent, and writes:
   - `demo/<kind>.cast.json` — timestamped transcript of exactly what appeared
   - `demo/<kind>.proof.txt` — the machine-checked proof of the run

2. `node demo/render.mjs force`  (or `email`)
   Renders the cast to MP4 (vertical 1080x1920 + landscape 1920x1080) with playwright + ffmpeg. Only the pacing of dead time is presentation-controlled; the content is the captured run. Videos regenerate from the committed cast with no Claude call.

## Proof (this recording)
- force:  real_interception=true, executed=false, origin unchanged (`force_push`, `protected_branch`)
- email:  real_interception=true, executed=false (`mass_send`)

See `force.proof.txt` / `email.proof.txt`.

## Files (videos are gitignored — regenerate with render.mjs, or find them locally at these paths)
- demo/not-yet-demo-vertical.mp4      1080x1920  ~16.5s   primary, social
- demo/not-yet-demo-landscape.mp4     1920x1080  ~16.5s   website / README
- demo/not-yet-demo-mcp-vertical.mp4  1080x1920  ~14.4s   optional MCP clip
- demo/not-yet-demo-mcp-landscape.mp4 1920x1080  ~14.4s
- demo/*.png                          poster frames (last frame of each)

## Safety
Disposable local resources only. No real GitHub remote, database, email provider, or deployment target is touched. `send_email` is a local fake; the force push targets a bare repo created seconds earlier inside the temp sandbox and deleted after.
