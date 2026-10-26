#!/usr/bin/env node
// Board data builder: merges tools/board/areas.json, the workspace ROADMAP.md, each worktree's
// context/NOW.md and the live /status into docs/board/board-data.js (window.MN_BOARD = {...};).
// No dependencies. Usage: node tools/board/build.mjs [--no-live] [--workspace <path>] [--status-url <url>]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_STATUS_URL = "https://marea.62.171.136.148.sslip.io/status";
const OUT_REL = "docs/board/board-data.js";

function parseArgs(argv) {
  const opts = { live: true, workspace: path.dirname(repoRoot), statusUrl: DEFAULT_STATUS_URL };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-live") opts.live = false;
    else if (a === "--workspace") opts.workspace = path.resolve(argv[++i] || "");
    else if (a === "--status-url") opts.statusUrl = argv[++i] || DEFAULT_STATUS_URL;
    else { console.error(`board: unknown argument ${a}`); process.exit(1); }
  }
  return opts;
}

// Drop the markdown a human wrote around plain words: code ticks, emphasis, links.
function stripMd(text) {
  return String(text ?? "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`+/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// Lines of the "## <heading>" section, up to the next "## " heading. Heading match is a prefix.
function section(lines, heading) {
  const start = lines.findIndex((l) => l.startsWith("## " + heading));
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out;
}

// Rows of a markdown table (header and separator dropped), each row an array of trimmed raw cells.
function tableRows(sectionLines) {
  const rows = sectionLines
    .filter((l) => l.trim().startsWith("|"))
    .map((l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()));
  return rows.filter((r, i) => i > 0 && !r.every((c) => /^:?-{2,}:?$/.test(c)));
}

// Top-level "- " bullets of a section, markdown stripped, kept whole.
function bullets(sectionLines) {
  return sectionLines.filter((l) => l.startsWith("- ")).map((l) => stripMd(l.slice(2)));
}

function normaliseStatus(cell) {
  const s = stripMd(cell).toLowerCase();
  if (s.startsWith("done")) return "done";
  if (s.startsWith("partial")) return "partial";
  if (s.startsWith("not started")) return "not-started";
  return "not-started";
}

function splitList(text, sep) {
  return String(text || "").split(sep).map((s) => s.trim()).filter(Boolean);
}

function parseNow(file) {
  const lines = fs.readFileSync(file, "utf8").replace(/\r/g, "").split("\n");
  const head = lines.find((l) => l.startsWith("# NOW")) || "";
  const m = head.match(/updated (\d{4}-\d{2}-\d{2}) by (T-\d+-\d+)/);
  return {
    ticket: m ? m[2] : "",
    updated: m ? m[1] : "",
    goal: bullets(section(lines, "Goal")),
    state: bullets(section(lines, "State")),
    next: bullets(section(lines, "Next")),
    open: bullets(section(lines, "Open")),
  };
}

// Any failure (network, timeout, bad JSON) returns null so the caller falls back to ROADMAP.md.
async function fetchStatus(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const raw = await res.json();
    return raw && typeof raw === "object" ? raw : null;
  } catch {
    return null;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  // a) curated areas
  let curated;
  try {
    curated = JSON.parse(fs.readFileSync(path.join(repoRoot, "tools/board/areas.json"), "utf8"));
    if (!Array.isArray(curated.areas)) throw new Error("areas.json has no areas array");
  } catch (err) {
    console.error(`board: cannot read tools/board/areas.json: ${err.message}`);
    process.exit(1);
  }

  // b) ROADMAP.md
  const roadmapPath = path.join(opts.workspace, "ROADMAP.md");
  if (!fs.existsSync(roadmapPath)) {
    console.error(`board: ROADMAP.md not found at ${roadmapPath}`);
    process.exit(1);
  }
  const rlines = fs.readFileSync(roadmapPath, "utf8").replace(/\r/g, "").split("\n");

  const milestones = tableRows(section(rlines, "Milestones")).map((r, i) => {
    const label = stripMd(r[0]);
    return {
      id: label.toLowerCase().replace(/\./g, "-"),
      label,
      order: i + 1,
      goal: stripMd(r[1]),
      status: normaliseStatus(r[2]),
      status_text: stripMd(r[2]),
      evidence: stripMd(r[3]),
    };
  });

  const areaRows = tableRows(section(rlines, "Areas")).map((r) => r.map(stripMd));
  const whereBullets = bullets(section(rlines, "Where we are"));
  const updatedLine = rlines.find((l) => l.startsWith("Updated ")) || "";
  const meta = {
    title: "Marea Negra Board",
    branch: "origin/claude/loving-lovelace-ptbif7",
    where_we_are: whereBullets.find((b) => b.startsWith("M")) || "",
    roadmap_updated: (updatedLine.match(/\d{4}-\d{2}-\d{2}/) || [""])[0],
  };

  const areas = [];
  const nowFiles = [];
  for (const src of curated.areas) {
    const area = { ...src };
    const row = areaRows.find((r) => r[0].startsWith(src.roadmap_row));
    if (row) {
      area.title = row[0].slice(src.roadmap_row.length).trim();
      const parts = splitList(row[1], ", ");
      let worktree = parts[0] || "", branch = parts[1] || "", lastCommit = parts[2] || "";
      // Two-part cells ("detached, <date>" or "<branch>, <date>") name no worktree: the folder is the area id.
      if (parts.length === 2 && /^\d{4}-\d{2}-\d{2}/.test(parts[1])) {
        worktree = src.id; branch = parts[0] === "detached" ? "" : parts[0]; lastCommit = parts[1];
      }
      area.worktree = worktree;
      area.branch = branch;
      area.last_commit = lastCommit;
      area.plan_docs = splitList(row[2], "; ");
      area.objective = row[3] || "";
      area.state = row[4] || "";
      area.next = row[5] || "";
    } else {
      console.warn(`WARN no ROADMAP.md row for area ${src.id} (roadmap_row "${src.roadmap_row}")`);
      Object.assign(area, { title: "", worktree: "", branch: "", last_commit: "", plan_docs: [], objective: "", state: "", next: "" });
    }

    // e) defaults (the artifact database overlays live values at runtime)
    area.status = area.worktree ? "idle" : "not-started";
    area.today = false;
    area.images = [];
    area.last_ticket = "";
    area.updated = "";

    // c) context/NOW.md
    const nowFile = path.join(opts.workspace, src.id, "context", "NOW.md");
    if (fs.existsSync(nowFile)) {
      area.now = parseNow(nowFile);
      area.last_ticket = area.now.ticket;
      area.updated = area.now.updated;
      nowFiles.push(nowFile.replace(/\\/g, "/"));
    } else {
      area.now = null;
    }

    // d) tasks: NOW.md Next bullets win over the ROADMAP Next cell
    const titles = area.now ? area.now.next : splitList(area.next, "; ");
    area.tasks = titles.map((title, i) => ({
      id: `${src.id}__${String(i + 1).padStart(2, "0")}`,
      area: src.id,
      n: i + 1,
      title,
      status: "open",
      ticket: "",
      started: "",
      finished: "",
      note: "",
    }));
    areas.push(area);
  }
  areas.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

  // f) live /status
  const liveBullet = whereBullets.find((b) => b.startsWith("Live:")) || "";
  const fbVersion = (liveBullet.match(/\d+\.\d+\.\d+[\w.-]*/) || [""])[0].replace(/[.,]$/, "");
  const fbProtocol = Number((liveBullet.match(/protocol (\d+)/) || [])[1]) || 0;
  const raw = opts.live ? await fetchStatus(opts.statusUrl) : null;
  const liveVersion = raw && typeof raw.version === "string" && /\d+\.\d+\.\d+/.test(raw.version) ? raw.version : "";
  if (liveVersion) {
    // The server's /status carries no protocol field today; take it from ROADMAP when absent.
    const proto = Number(raw.protocol ?? raw.protocolVersion);
    meta.live_version = liveVersion;
    meta.protocol = Number.isFinite(proto) && proto > 0 ? proto : fbProtocol;
    meta.live_raw = raw;
    meta.live_ok = true;
  } else {
    meta.live_version = fbVersion;
    meta.protocol = fbProtocol;
    meta.live_ok = false;
  }

  // g) meta tail
  meta.generated = new Date().toISOString();
  meta.sources = { roadmap: roadmapPath.replace(/\\/g, "/"), now_files: nowFiles, status_url: opts.statusUrl };

  const tasks = areas.flatMap((a) => a.tasks);
  const board = { meta, milestones, areas, tasks };
  const outFile = path.join(repoRoot, OUT_REL);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, "window.MN_BOARD = " + JSON.stringify(board, null, 2) + ";\n", "utf8");
  console.log(`board: areas ${areas.length} | milestones ${milestones.length} | now files ${nowFiles.length} | tasks ${tasks.length} | live ${meta.live_ok ? "ok" : "fallback"} | wrote ${OUT_REL}`);
}

main().catch((err) => { console.error(`board: ${err.stack || err}`); process.exit(1); });
