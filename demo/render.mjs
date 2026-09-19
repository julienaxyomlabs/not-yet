#!/usr/bin/env node
// Renders a captured .cast.json to MP4 (vertical + landscape). The content is
// the real run; only the pacing of dead time is presentation-controlled.
//   node demo/render.mjs force
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "/Users/julienpoulain/Desktop/axyom materials/griotta-mac-browser-demo/extension-src/node_modules/playwright/index.mjs";

const KIND = process.argv[2] || "force";
const DIR = path.dirname(fileURLToPath(import.meta.url));
const cast = JSON.parse(fs.readFileSync(path.join(DIR, `${KIND}.cast.json`), "utf8"));

// pacing: each captured line gets a hold; real content, snappy dead time
function steps() {
  const out = [];
  for (let i = 0; i < cast.length; i++) {
    const { text, cls } = cast[i];
    let hold = text.trim() === "" ? 90 : 190;
    if (cls === "run" || cls === "ok") hold = 260;
    if (cls === "danger" && /--force|send_email|1842/.test(text)) hold = 850;   // the consequential line lands
    if (text === "NOT YET") hold = 950;                                          // the interruption breathes
    if (text.trim().startsWith("[ approve ]")) hold = 2200;                      // read the choice
    if (text.trim() === "reject") hold = 1100;
    if (cls === "fact") hold = 150;
    if (/unchanged|no email was sent/.test(text)) hold = 1600;
    out.push({ text, cls, hold });
  }
  return out;
}

const V = { name: "vertical", w: 1080, h: 1920, fs: 30, pad: 72, top: 300 };
const L = { name: "landscape", w: 1920, h: 1080, fs: 32, pad: 120, top: 90 };

function pageHtml(o) {
  const data = JSON.stringify(steps());
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;height:100%;background:#0a0a0a;overflow:hidden}
  *{box-sizing:border-box}
  #stage{width:${o.w}px;height:${o.h}px;background:#0a0a0a;position:relative;font-family:'IBM Plex Mono',ui-monospace,Menlo,monospace}
  #term{position:absolute;left:${o.pad}px;right:${o.pad}px;top:${o.top}px;bottom:${o.pad}px;overflow:hidden}
  #flow{position:absolute;left:0;right:0;top:0;font-size:${o.fs}px;line-height:1.62;color:#f3f0e8;white-space:pre-wrap;word-break:break-word;letter-spacing:.01em}
  .l{opacity:0;transform:translateY(3px);animation:in .18s ease forwards}
  @keyframes in{to{opacity:1;transform:none}}
  .dim{color:#8d8a83}.bold{color:#f3f0e8;font-weight:600}.run{color:#f3f0e8}.ok{color:#c9c6bd}
  .danger{color:#e8562a;font-weight:600}.fact{color:#f3f0e8}
  .cur{display:inline-block;width:${Math.round(o.fs*.55)}px;height:${o.fs}px;background:#f3f0e8;vertical-align:-3px;animation:bk 1s steps(1) infinite}
  @keyframes bk{50%{opacity:0}}
  #end{position:absolute;inset:0;background:#0a0a0a;display:flex;flex-direction:column;justify-content:center;padding:0 ${o.pad}px;opacity:0}
  #end.show{opacity:1;transition:opacity .5s ease}
  #end .mark{font-size:${o.name==="vertical"?150:140}px;font-weight:600;letter-spacing:-.04em;color:#f3f0e8;line-height:.9}
  #end .sub{font-size:${o.name==="vertical"?44:42}px;font-weight:500;color:#f3f0e8;margin-top:${o.name==="vertical"?40:28}px;letter-spacing:-.01em}
  #end .foot{font-size:${o.name==="vertical"?30:28}px;color:#8d8a83;margin-top:${o.name==="vertical"?90:60}px;line-height:1.5}
  #eyebrow{position:absolute;left:${o.pad}px;top:${o.name==="vertical"?150:44}px;font-size:${Math.round(o.fs*.62)}px;letter-spacing:.16em;color:#8d8a83}
</style></head>
<body><div id="stage">
  <div id="eyebrow">OMBRISE / EXPERIMENT 003</div>
  <div id="term"><div id="flow"></div></div>
  <div id="end"><div class="mark">NOT YET</div><div class="sub">pause before consequential actions.</div><div class="foot">griotta slows humans.<br>not yet slows agents.</div></div>
</div>
<script>
  const STEPS=${data};
  const term=document.getElementById('term'), flow=document.getElementById('flow'), end=document.getElementById('end');
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  let cursor;
  function addCursor(){cursor=document.createElement('span');cursor.className='cur';flow.appendChild(cursor);}
  (async()=>{
    await sleep(500);
    for(const s of STEPS){
      if(cursor)cursor.remove();
      const div=document.createElement('div');div.className='l '+(s.cls||'');div.textContent=s.text||' ';flow.appendChild(div);
      addCursor();
      // keep the latest lines in view (scroll the flow inside the clipped window)
      const winH=${o.h}-${o.top}-${o.pad};
      const over=flow.scrollHeight-winH;
      if(over>0)flow.style.transform='translateY('+(-over)+'px)';
      await sleep(s.hold);
    }
    if(cursor)cursor.remove();
    await sleep(1100);
    term.style.transition='opacity .35s ease'; term.style.opacity='0';
    await sleep(380);
    end.classList.add('show');
    await sleep(3600);
    window.__done=true;
  })();
</script></body></html>`;
}

async function renderOne(o) {
  const html = pageHtml(o);
  const htmlFile = path.join(DIR, `.${KIND}.${o.name}.html`); fs.writeFileSync(htmlFile, html);
  const vdir = fs.mkdtempSync(path.join(os.tmpdir(), "nyvid-"));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: o.w, height: o.h }, recordVideo: { dir: vdir, size: { width: o.w, height: o.h } }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto("file://" + htmlFile);
  await page.waitForFunction("window.__done === true", null, { timeout: 60000 });
  await page.waitForTimeout(200);
  await ctx.close(); await browser.close();
  const webm = fs.readdirSync(vdir).find((f) => f.endsWith(".webm"));
  const src = path.join(vdir, webm);
  const stem = KIND === "force" ? `not-yet-demo-${o.name}` : `not-yet-demo-mcp-${o.name}`;
  const out = path.join(DIR, `${stem}.mp4`);
  const r = spawnSync("ffmpeg", ["-y", "-i", src, "-vf", `scale=${o.w}:${o.h}:flags=lanczos,format=yuv420p`, "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-movflags", "+faststart", "-an", out], { stdio: "ignore" });
  if (r.status !== 0) throw new Error("ffmpeg failed for " + o.name);
  // poster: last frame
  spawnSync("ffmpeg", ["-y", "-sseof", "-1", "-i", out, "-frames:v", "1", path.join(DIR, `${stem}.png`)], { stdio: "ignore" });
  fs.rmSync(vdir, { recursive: true, force: true }); fs.unlinkSync(htmlFile);
  const dur = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", out]).stdout?.toString().trim();
  console.log(`  ${o.name}: ${out}  ${o.w}x${o.h}  ${dur}s`);
  return out;
}

console.log(`rendering ${KIND}:`);
await renderOne(V);
await renderOne(L);
console.log("done");
