/**
 * HTML basics test server.
 *
 * Storage:
 *   - When DATABASE_URL is set (Render + Neon Postgres), submissions go to the
 *     `submissions` table.
 *   - Otherwise, submissions are appended as JSON lines to data/submissions.ndjson
 *     (used for local development).
 *
 * Grading uses answer_key.json. Each row gets `graded`, `scoreTotal`, and `scoreMax`.
 * Student-facing questions: GET /api/quiz.php (quiz_publish.json + quiz_content.json, no answer key).
 */

import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3847);

/** Trim + treat empty env as unset so Render/newlines mismatches don't brick admin GET. */
function readAdminToken() {
  const raw = process.env.HTML_TEST_ADMIN_TOKEN;
  if (raw == null) return "devtoken";
  const s = String(raw).trim();
  return s === "" ? "devtoken" : s;
}

const ADMIN_TOKEN = readAdminToken();
const DATABASE_URL = process.env.DATABASE_URL || "";

function readQueryToken(query) {
  const t = query?.token;
  if (Array.isArray(t)) return String(t[0] ?? "").trim();
  return String(t ?? "").trim();
}

/** Query ?token=… or header Authorization: Bearer … or form field admin_token (teacher pages). */
function readRequestAdminToken(req) {
  const fromQuery = readQueryToken(req.query);
  if (fromQuery) return fromQuery;
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const formTok = req.body?.admin_token;
  if (typeof formTok === "string" && formTok.trim()) return formTok.trim();
  return "";
}

const DATA_DIR = path.join(__dirname, "data");
const STORE = path.join(DATA_DIR, "submissions.ndjson");
const ANSWER_KEY_PATH = path.join(__dirname, "answer_key.json");
const QUIZ_CONTENT_PATH = path.join(__dirname, "quiz_content.json");
const QUIZ_PUBLISH_PATH = path.join(__dirname, "quiz_publish.json");
/** Upper bound for exercise ids from the bank (sanity check). */
const MAX_EXERCISE_ID = 9999;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ---------- Answer key + grading ----------

let answerKeyCache = null;
let answerKeyMtime = 0;

function loadAnswerKey() {
  const stat = fs.statSync(ANSWER_KEY_PATH);
  if (answerKeyCache && stat.mtimeMs === answerKeyMtime) return answerKeyCache;
  const raw = fs.readFileSync(ANSWER_KEY_PATH, "utf8");
  const json = JSON.parse(raw);
  const out = {};
  for (const [k, v] of Object.entries(json)) {
    if (!k || k.startsWith("$")) continue;
    if (v && typeof v === "object") out[String(k)] = v;
  }
  answerKeyCache = out;
  answerKeyMtime = stat.mtimeMs;
  return out;
}

// ---------- Teacher review (HTML) ----------

let quizContentCache = null;
let quizContentMtime = 0;

function loadQuizContent() {
  const stat = fs.statSync(QUIZ_CONTENT_PATH);
  if (quizContentCache && stat.mtimeMs === quizContentMtime) return quizContentCache;
  const raw = fs.readFileSync(QUIZ_CONTENT_PATH, "utf8");
  const json = JSON.parse(raw);
  const out = {};
  for (const [k, v] of Object.entries(json)) {
    if (!k || k.startsWith("$")) continue;
    if (v && typeof v === "object") out[k] = v;
  }
  quizContentCache = out;
  quizContentMtime = stat.mtimeMs;
  return out;
}

let publishConfigMem = null;

let quizPublishCache = null;
let quizPublishMtime = 0;

function readQuizPublishFile() {
  const stat = fs.statSync(QUIZ_PUBLISH_PATH);
  if (quizPublishCache && stat.mtimeMs === quizPublishMtime) return quizPublishCache;
  const raw = fs.readFileSync(QUIZ_PUBLISH_PATH, "utf8");
  quizPublishCache = JSON.parse(raw);
  quizPublishMtime = stat.mtimeMs;
  return quizPublishCache;
}

function loadQuizPublishConfig() {
  if (publishConfigMem !== null) return publishConfigMem;
  publishConfigMem = readQuizPublishFile();
  return publishConfigMem;
}

async function refreshPublishConfigFromStorage() {
  publishConfigMem = null;
  if (pool) {
    try {
      const { rows } = await pool.query(`SELECT config FROM quiz_settings WHERE id = 1`);
      if (rows[0]?.config) {
        publishConfigMem = rows[0].config;
        return;
      }
    } catch (e) {
      console.error("quiz_settings load failed", e);
    }
  }
  publishConfigMem = readQuizPublishFile();
}

async function savePublishConfig(next) {
  const clean = { ...next };
  for (const k of Object.keys(clean)) {
    if (k.startsWith("$")) delete clean[k];
  }
  publishConfigMem = clean;
  if (pool) {
    await pool.query(
      `INSERT INTO quiz_settings (id, config, updated_at) VALUES (1, $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()`,
      [JSON.stringify(clean)],
    );
    return;
  }
  fs.writeFileSync(QUIZ_PUBLISH_PATH, JSON.stringify(clean, null, 2) + "\n", "utf8");
  quizPublishCache = clean;
  quizPublishMtime = fs.statSync(QUIZ_PUBLISH_PATH).mtimeMs;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

function buildPublishedSnapshot() {
  const cfg = loadQuizPublishConfig();
  const revNum = Number(cfg.revision);
  const revision = Number.isInteger(revNum) && revNum > 0 ? revNum : 1;
  if (cfg.active === false) {
    return { active: false, revision, exerciseIds: [], message: cfg.message ?? null };
  }
  const bank = loadQuizContent();
  const mode = String(cfg.mode || "explicit").toLowerCase();
  let ids = [];
  if (mode === "filter") {
    const levels = new Set((cfg.filterLevels || ["beginner"]).map(String));
    const types = new Set((cfg.filterTypes || ["mcq", "short", "fill"]).map(String));
    const maxCount = Math.min(500, Math.max(1, Number(cfg.maxCount) || 30));
    const pool = [];
    for (const [k, row] of Object.entries(bank)) {
      if (!k || k.startsWith("$") || typeof row !== "object") continue;
      const id = Number(k);
      if (!Number.isInteger(id) || id < 1 || id > MAX_EXERCISE_ID) continue;
      const level = row.level != null ? String(row.level) : "beginner";
      const t = String(row.type || "");
      if (!levels.has(level)) continue;
      if (!types.has(t)) continue;
      pool.push(id);
    }
    shuffleInPlace(pool);
    ids = pool.slice(0, maxCount);
  } else {
    ids = (cfg.exerciseIds || [])
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= MAX_EXERCISE_ID);
  }
  ids = [...new Set(ids)];
  if (cfg.shuffleQuestions !== false) shuffleInPlace(ids);
  if (ids.length === 0) {
    return {
      active: false,
      revision,
      exerciseIds: [],
      message: cfg.message || "No questions matched the publish rules.",
    };
  }
  ids = ids.filter((id) => bank[String(id)]);
  if (ids.length === 0) {
    return {
      active: false,
      revision,
      exerciseIds: [],
      message: cfg.message || "Published exercise ids do not match quiz_content.json.",
    };
  }
  return { active: true, revision, exerciseIds: ids, message: cfg.message ?? null };
}

function bankRowToApiExercise(id, row) {
  if (!row || typeof row !== "object") return null;
  const t = String(row.type || "");
  if (t === "mcq") {
    const ch = row.choices;
    if (!ch || typeof ch !== "object") return null;
    const choices = Object.keys(ch)
      .sort()
      .map((cid) => ({ id: String(cid), label: String(ch[cid] ?? "") }));
    return {
      id,
      type: "mcq",
      title: String(row.title ?? ""),
      prompt: String(row.prompt ?? ""),
      choices,
    };
  }
  if (t === "short") {
    return {
      id,
      type: "short",
      title: String(row.title ?? ""),
      prompt: String(row.prompt ?? ""),
      placeholder: String(row.studentHint ?? row.placeholder ?? "Type your answer"),
    };
  }
  if (t === "fill") {
    return {
      id,
      type: "fill",
      title: String(row.title ?? ""),
      prompt: String(row.prompt ?? ""),
      code: String(row.code ?? ""),
      placeholder: String(row.studentHint ?? row.placeholder ?? "Type only what fills the blank"),
    };
  }
  return null;
}

function handleGetQuiz(_req, res) {
  try {
    const snap = buildPublishedSnapshot();
    if (!snap.active) {
      return res.json({
        ok: true,
        active: false,
        revision: snap.revision,
        message: snap.message || "No test at this time.",
        exercises: [],
      });
    }
    const bank = loadQuizContent();
    const exercises = [];
    for (const id of snap.exerciseIds) {
      const ex = bankRowToApiExercise(id, bank[String(id)]);
      if (ex) exercises.push(ex);
    }
    return res.json({
      ok: true,
      active: true,
      revision: snap.revision,
      message: snap.message,
      exercises,
    });
  } catch (e) {
    console.error("quiz fetch failed", e);
    return res.status(500).json({ ok: false, error: "quiz_load_failed" });
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildManageQuizHtml(cfg, token, saved, error) {
  const e = escapeHtml;
  const mode = String(cfg.mode || "explicit");
  const idsText = e((cfg.exerciseIds || []).join(", "));
  const levelsText = e((cfg.filterLevels || ["beginner"]).join(", "));
  const types = new Set(cfg.filterTypes || ["mcq", "short", "fill"]);
  const act = cfg.active !== false;
  const rev = Number(cfg.revision) || 1;
  const msg = e(String(cfg.message ?? ""));
  const maxC = Number(cfg.maxCount) || 30;
  const shuf = cfg.shuffleQuestions !== false;
  const err = error ? `<p class="err">${e(error)}</p>` : "";
  const ok = saved ? `<p class="ok">Saved. Have students reopen the app (or tap Check again) so they get the new quiz.</p>` : "";
  const tokField = e(token);
  const action = `/manage-quiz?token=${encodeURIComponent(token)}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Quiz settings (no code)</title>
<style>
  body { font-family: system-ui,Segoe UI,Roboto,sans-serif; max-width: 42rem; margin: 1.2rem auto; padding: 0 0.8rem; line-height: 1.45; color: #1a1d26; }
  h1 { font-size: 1.35rem; }
  .hint { color: #5a6270; font-size: 0.9rem; margin: 0.2rem 0 0.8rem; }
  label { display: block; font-weight: 600; margin-top: 0.75rem; }
  input[type=text], input[type=number], textarea, select { width: 100%; box-sizing: border-box; padding: 0.45rem; margin-top: 0.2rem; }
  textarea { min-height: 5rem; }
  .row { margin-top: 0.5rem; }
  button { margin-top: 1rem; padding: 0.55rem 1.1rem; font-size: 1rem; cursor: pointer; }
  .ok { color: #0b5c36; font-weight: 600; }
  .err { color: #b00020; font-weight: 600; }
  fieldset { border: 1px solid #cfd6e4; border-radius: 8px; margin-top: 0.75rem; padding: 0.6rem 0.9rem; }
  legend { font-weight: 700; padding: 0 0.35rem; }
</style>
</head>
<body>
<h1>Quiz settings (no JSON required)</h1>
<p class="hint">This page only controls <strong>which questions go live</strong>, <strong>how many</strong>, and <strong>whether the test is on</strong>. To change the wording of a question you still edit <code>quiz_content.json</code> on the server (or ask someone technical) — but day‑to‑day class control is meant to happen here.</p>
${ok}${err}
<form method="post" action="${action}">
  <input type="hidden" name="admin_token" value="${tokField}"/>
  <label><input type="checkbox" name="active" value="1" ${act ? "checked" : ""}/> Students can take the quiz right now</label>
  <label>Short message for students (optional)</label>
  <textarea name="message" placeholder="Shown on phones when the quiz loads">${msg}</textarea>
  <label>Quiz version number</label>
  <input type="number" name="revision" min="1" value="${rev}"/>
  <p class="hint">If students still have an old quiz open, increase this number (or use the checkbox below) so their submit is accepted.</p>
  <label><input type="checkbox" name="bump_revision" value="1"/> After save, automatically set version to current + 1</label>
  <fieldset>
    <legend>How should questions be chosen?</legend>
    <label><input type="radio" name="mode" value="explicit" ${mode !== "filter" ? "checked" : ""}/> I will type the question numbers I want (see list in <code>quiz_content.json</code>)</label>
    <label><input type="radio" name="mode" value="filter" ${mode === "filter" ? "checked" : ""}/> Let the server pick randomly by rules (good for practice)</label>
  </fieldset>
  <div id="explicitBlock">
    <label>Question numbers (commas or spaces, e.g. 1, 2, 5, 8)</label>
    <textarea name="exercise_ids" placeholder="1, 2, 3, 4, 5">${idsText}</textarea>
  </div>
  <div id="filterBlock">
    <label>Difficulty levels to include (comma-separated)</label>
    <input type="text" name="filter_levels" value="${levelsText}"/>
    <p class="hint">Each question can have a <code>level</code> in the bank file; if missing, it counts as <code>beginner</code>.</p>
    <div class="row"><strong>Question types to include</strong></div>
    <label><input type="checkbox" name="type_mcq" value="1" ${types.has("mcq") ? "checked" : ""}/> Multiple choice</label>
    <label><input type="checkbox" name="type_short" value="1" ${types.has("short") ? "checked" : ""}/> Short typing</label>
    <label><input type="checkbox" name="type_fill" value="1" ${types.has("fill") ? "checked" : ""}/> Fill in the blank</label>
    <label>Maximum number of questions</label>
    <input type="number" name="max_count" min="1" max="500" value="${maxC}"/>
  </div>
  <label><input type="checkbox" name="shuffle" value="1" ${shuf ? "checked" : ""}/> Shuffle question order each time the server builds the quiz list</label>
  <button type="submit">Save settings</button>
</form>
<p class="hint"><a href="/api/quiz.php">Preview what students get (JSON)</a> · <a href="/review?token=${encodeURIComponent(token)}">Open marker review</a></p>
</body></html>`;
}

async function handleGetManageQuiz(req, res) {
  const token = readRequestAdminToken(req);
  if (token !== ADMIN_TOKEN) {
    return res.status(401).type("html").send("<!DOCTYPE html><html><body><h1>Unauthorized</h1></body></html>");
  }
  const cfg = loadQuizPublishConfig();
  const html = buildManageQuizHtml(cfg, token, req.query.saved === "1", null);
  res.type("html").send(html);
}

async function handlePostManageQuiz(req, res) {
  const token = readRequestAdminToken(req);
  if (token !== ADMIN_TOKEN) {
    return res.status(401).type("html").send("<!DOCTYPE html><html><body><h1>Unauthorized</h1></body></html>");
  }
  try {
    const b = req.body || {};
    const active = b.active === "1" || b.active === "on";
    const mode = b.mode === "filter" ? "filter" : "explicit";
    const current = loadQuizPublishConfig();
    const oldRev = Number(current.revision) || 1;
    const bump = b.bump_revision === "1" || b.bump_revision === "on";
    const revInput = Math.max(1, parseInt(String(b.revision || "1"), 10) || 1);
    const nextRev = bump ? oldRev + 1 : revInput;
    const message = String(b.message || "").trim() || null;
    const parseIds = (s) =>
      [
        ...new Set(
          String(s || "")
            .split(/[\s,]+/)
            .map((x) => parseInt(x, 10))
            .filter((n) => Number.isInteger(n) && n >= 1 && n <= MAX_EXERCISE_ID),
        ),
      ];
    const exerciseIds = parseIds(b.exercise_ids);
    const levels = String(b.filter_levels || "beginner")
      .split(/[,\s]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    const ft = [];
    if (b.type_mcq === "1" || b.type_mcq === "on") ft.push("mcq");
    if (b.type_short === "1" || b.type_short === "on") ft.push("short");
    if (b.type_fill === "1" || b.type_fill === "on") ft.push("fill");
    const maxCount = Math.min(500, Math.max(1, parseInt(String(b.max_count || "30"), 10) || 30));
    const shuffleQuestions = b.shuffle === "1" || b.shuffle === "on";

    if (mode === "explicit" && exerciseIds.length === 0) {
      const html = buildManageQuizHtml(current, token, false, "Add at least one question number, or switch to automatic mode.");
      return res.status(400).type("html").send(html);
    }

    const next = {
      active,
      revision: nextRev,
      message,
      mode,
      exerciseIds: mode === "explicit" ? exerciseIds : current.exerciseIds || [],
      filterLevels: levels.length ? levels : ["beginner"],
      filterTypes: ft.length ? ft : ["mcq", "short", "fill"],
      maxCount,
      shuffleQuestions,
    };
    await savePublishConfig(next);
    res.redirect(302, `/manage-quiz?token=${encodeURIComponent(token)}&saved=1`);
  } catch (err) {
    console.error("manage quiz save", err);
    const cfg = loadQuizPublishConfig();
    const html = buildManageQuizHtml(cfg, token, false, "Could not save. Check server logs.");
    res.status(500).type("html").send(html);
  }
}

/** Plain-text line for one MCQ choice letter + label (caller escapes for HTML). */
function formatMcqLine(choices, choiceId) {
  if (choiceId == null || String(choiceId).trim() === "") return "(no answer)";
  const id = String(choiceId).trim().toLowerCase();
  const line = choices?.[id];
  if (!line) return `${id}) (choice not found on question card)`;
  return `${id}) ${line}`;
}

function formatCorrectLine(keyRow, quizRow) {
  if (!keyRow || typeof keyRow !== "object") return "(no answer key)";
  if (keyRow.type === "mcq") {
    return formatMcqLine(quizRow?.choices, keyRow.correctChoiceId);
  }
  if (keyRow.type === "text") {
    const arr = Array.isArray(keyRow.acceptedAnswers) ? keyRow.acceptedAnswers : [];
    return arr.length ? arr.join(" · ") : "(no accepted answers listed)";
  }
  return "(unknown type)";
}

function formatStudentLine(ansRow, keyRow, quizRow) {
  if (!keyRow || typeof keyRow !== "object") return "(unknown)";
  if (keyRow.type === "mcq") {
    return formatMcqLine(quizRow?.choices, ansRow?.selectedChoiceId);
  }
  const t = ansRow?.typedAnswer;
  if (t == null || String(t).trim() === "") return "(blank)";
  return String(t);
}

function buildReviewPageHtml(submissions) {
  const key = loadAnswerKey();
  const quiz = loadQuizContent();
  const parts = [];
  parts.push(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>HTML basics test — marker review</title>
<style>
  :root { --bg:#f0f2f7; --card:#fff; --text:#161922; --muted:#5a6270; --ok:#0b5c36; --bad:#8f1e1e; --border:#cfd6e4; }
  body { font-family: system-ui, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); margin:0; padding: 1rem 1.1rem 2.5rem; line-height:1.5; }
  h1 { font-size: 1.35rem; margin: 0 0 0.35rem; }
  .subhead { color: var(--muted); margin: 0 0 1.25rem; font-size: 0.95rem; max-width: 52rem; }
  .submission { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 1rem 1.15rem; margin-bottom: 1.75rem; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  .submeta { font-size: 0.86rem; color: var(--muted); margin: 0 0 0.85rem; line-height: 1.4; }
  .score { font-weight: 700; font-size: 1.05rem; color: var(--text); margin-bottom: 0.75rem; }
  .q { border: 1px solid var(--border); border-radius: 8px; padding: 0.65rem 0.85rem; margin-bottom: 0.55rem; background: #fafbff; }
  .qhead { display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem 0.75rem; margin-bottom: 0.3rem; }
  .qid { font-weight: 700; }
  .ok { background: #daf3e4; color: var(--ok); padding: 0.12rem 0.45rem; border-radius: 4px; font-size: 0.78rem; font-weight: 700; }
  .bad { background: #fde2e2; color: var(--bad); padding: 0.12rem 0.45rem; border-radius: 4px; font-size: 0.78rem; font-weight: 700; }
  .prompt { margin: 0.15rem 0 0.45rem; }
  .choices { margin: 0.25rem 0 0.35rem; }
  .choices strong { font-size: 0.78rem; color: var(--muted); }
  .choices ul { margin: 0.2rem 0 0; padding-left: 1.15rem; }
  .choices li { margin: 0.12rem 0; }
  code { font-family: ui-monospace, Consolas, monospace; background: #e8ecf4; padding: 0.06rem 0.3rem; border-radius: 3px; font-size: 0.86em; }
  pre.code { margin: 0.3rem 0 0.2rem; padding: 0.55rem 0.7rem; background: #1e2430; color: #e8ecf1; border-radius: 6px; overflow-x: auto; font-size: 0.8rem; line-height: 1.38; white-space: pre-wrap; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.45rem 1rem; margin-top: 0.4rem; }
  @media (max-width: 760px) { .row { grid-template-columns: 1fr; } }
  .lbl { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); font-weight: 700; }
  .val { font-size: 0.92rem; word-break: break-word; }
  .hint { font-size: 0.82rem; color: var(--muted); margin: 0.3rem 0 0; }
  .empty { color: var(--muted); padding: 1rem 0; }
</style>
</head>
<body>
<h1>HTML basics test — marker review</h1>
<p class="subhead">Submissions are listed newest first. Each question shows the wording your students saw, every multiple-choice option (letters <code>a</code>–<code>d</code> match what is stored and graded; the app may shuffle the order of buttons on the phone), the student’s answer, what the answer key accepts as correct, and auto-mark correct/incorrect. Scores are at the top of each submission; you can still award partial credit outside this page.</p>`);

  if (!Array.isArray(submissions) || submissions.length === 0) {
    parts.push('<p class="empty">No submissions yet.</p></body></html>');
    return parts.join("\n");
  }

  for (const sub of submissions) {
    const label = sub.participantLabel ? escapeHtml(sub.participantLabel) : "<em>(no name)</em>";
    const score = `${sub.scoreTotal ?? "?"}/${sub.scoreMax ?? "?"}`;
    parts.push(`<section class="submission">
<div class="score">Score: ${escapeHtml(String(score))} — ${label}</div>
<div class="submeta">
<strong>Submission id</strong> <code>${escapeHtml(sub.id)}</code><br/>
<strong>Received (server)</strong> ${escapeHtml(sub.receivedAt ?? "")}<br/>
<strong>Sent from device</strong> ${escapeHtml(sub.clientSubmittedAt ?? "")}<br/>
<strong>User agent</strong> ${escapeHtml(sub.userAgent ?? "")}<br/>
<strong>Quiz revision</strong> ${escapeHtml(String(sub.quizRevision ?? "—"))}<br/>
<strong>Published exercise ids</strong> <code>${escapeHtml(JSON.stringify(sub.publishedExerciseIds ?? []))}</code>
</div>`);

    const ansById = Object.fromEntries((sub.answers || []).map((a) => [String(a.exerciseId), a]));
    const gradeById = Object.fromEntries((sub.graded || []).map((g) => [String(g.exerciseId), g]));

    const order =
      Array.isArray(sub.publishedExerciseIds) && sub.publishedExerciseIds.length > 0
        ? sub.publishedExerciseIds.map((n) => Number(n)).filter((n) => Number.isInteger(n))
        : [...new Set((sub.answers || []).map((a) => Number(a.exerciseId)).filter((n) => Number.isInteger(n)))].sort(
            (a, b) => a - b,
          );

    let qn = 0;
    for (const i of order) {
      qn++;
      const sid = String(i);
      const quizRow = quiz[sid] || {};
      const keyRow = key[sid];
      const ansRow = ansById[sid] || {};
      const gr = gradeById[sid];
      const correct = gr?.correct === true;
      const badge = correct ? '<span class="ok">Correct</span>' : '<span class="bad">Incorrect</span>';
      const title = escapeHtml(quizRow.title || `Question ${sid}`);
      const prompt = escapeHtml(
        quizRow.prompt || "(no prompt in quiz_content.json — add this id to the bank)",
      );
      let bodyExtra = "";
      if (quizRow.choices && typeof quizRow.choices === "object") {
        bodyExtra += '<div class="choices"><strong>All choices (as on the student’s device)</strong><ul>';
        for (const [cid, text] of Object.entries(quizRow.choices)) {
          bodyExtra += `<li><code>${escapeHtml(cid)}</code> — ${escapeHtml(text)}</li>`;
        }
        bodyExtra += "</ul></div>";
      }
      if (quizRow.code) {
        bodyExtra += `<div class="lbl" style="margin-top:0.35rem">Code / blank</div><pre class="code">${escapeHtml(quizRow.code)}</pre>`;
      }
      if (quizRow.studentHint) {
        bodyExtra += `<p class="hint"><strong>On-screen hint:</strong> ${escapeHtml(quizRow.studentHint)}</p>`;
      }
      const studentLine = formatStudentLine(ansRow, keyRow, quizRow);
      const correctLine = formatCorrectLine(keyRow, quizRow);
      parts.push(`<article class="q">
<div class="qhead"><span class="qid">Q${qn}</span> <span style="color:var(--muted);font-size:0.82rem">id ${escapeHtml(sid)}</span> ${badge}<span style="color:var(--muted);font-size:0.88rem">${title}</span></div>
<p class="prompt">${prompt}</p>
${bodyExtra}
<div class="row">
  <div><div class="lbl">Student answer</div><div class="val">${escapeHtml(studentLine)}</div></div>
  <div><div class="lbl">Marked correct (answer key)</div><div class="val">${escapeHtml(correctLine)}</div></div>
</div>
</article>`);
    }
    parts.push("</section>");
  }
  parts.push("</body></html>");
  return parts.join("\n");
}

function normalizeText(s) {
  return String(s ?? "").trim().toLowerCase();
}

function gradeOne(keyRow, ansRow) {
  if (!keyRow || typeof keyRow !== "object") return false;
  if (keyRow.type === "mcq") {
    const sel = normalizeText(ansRow?.selectedChoiceId);
    const cor = normalizeText(keyRow.correctChoiceId);
    return sel !== "" && cor !== "" && sel === cor;
  }
  if (keyRow.type === "text") {
    const typed = String(ansRow?.typedAnswer ?? "").trim();
    if (typed === "") return false;
    const typedNorm = normalizeText(typed);
    const accepted = Array.isArray(keyRow.acceptedAnswers) ? keyRow.acceptedAnswers : [];
    return accepted.some((a) => typeof a === "string" && normalizeText(a) === typedNorm);
  }
  return false;
}

function gradeSubmission(answers) {
  const key = loadAnswerKey();
  const graded = [];
  let scoreTotal = 0;
  let scoreMax = 0;
  for (const row of answers) {
    const eid = Number(row?.exerciseId);
    if (!Number.isInteger(eid) || eid < 1) continue;
    const keyRow = key[String(eid)];
    if (!keyRow) {
      graded.push({ exerciseId: eid, correct: false, reason: "unknown_exercise" });
      scoreMax++;
      continue;
    }
    const ok = gradeOne(keyRow, row);
    if (ok) scoreTotal++;
    scoreMax++;
    const entry = { exerciseId: eid, type: keyRow.type ?? null, correct: ok };
    if (row.selectedChoiceId !== undefined && row.selectedChoiceId !== null) {
      entry.selectedChoiceId = row.selectedChoiceId;
    }
    if (row.typedAnswer !== undefined && row.typedAnswer !== null) {
      entry.typedAnswer = row.typedAnswer;
    }
    graded.push(entry);
  }
  return { graded, scoreTotal, scoreMax };
}

// ---------- Validation ----------

function summarizeAnswers(answers) {
  if (!Array.isArray(answers)) return [];
  return answers.map((a) => ({
    exerciseId: a?.exerciseId,
    selectedChoiceId: a?.selectedChoiceId ?? null,
    typedAnswer: a?.typedAnswer ?? null,
  }));
}

function validateBody(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_json" };
  const answers = body.answers;
  if (!Array.isArray(answers)) return { ok: false, error: "answers_required" };

  /** Old Android builds: 30 answers, ids 1–30, no quizRevision. Only valid while publish is still the full 30. */
  const legacy =
    (body.quizRevision === undefined || body.quizRevision === null || body.quizRevision === "") &&
    answers.length === 30;
  if (legacy) {
    const seen = new Set();
    for (const row of answers) {
      if (!row || typeof row !== "object") return { ok: false, error: "answer_shape" };
      const eid = Number(row.exerciseId);
      if (!Number.isInteger(eid) || eid < 1 || eid > 30) return { ok: false, error: "exercise_id_range" };
      if (seen.has(eid)) return { ok: false, error: "duplicate_exercise_id" };
      seen.add(eid);
    }
    for (let i = 1; i <= 30; i++) {
      if (!seen.has(i)) return { ok: false, error: "missing_exercise_id" };
    }
    const snap = buildPublishedSnapshot();
    if (!snap.active || snap.exerciseIds.length !== 30) {
      return { ok: false, error: "quiz_revision" };
    }
    const sset = new Set(snap.exerciseIds);
    for (let i = 1; i <= 30; i++) {
      if (!sset.has(i)) return { ok: false, error: "quiz_revision" };
    }
    return { ok: true, publishedExerciseIds: [...Array(30)].map((_, i) => i + 1), quizRevision: 0 };
  }

  const snap = buildPublishedSnapshot();
  if (!snap.active) return { ok: false, error: "no_active_quiz" };
  const rev = Number(body.quizRevision);
  if (!Number.isInteger(rev) || rev !== snap.revision) {
    return { ok: false, error: "quiz_revision" };
  }
  const expected = new Set(snap.exerciseIds);
  if (answers.length !== expected.size) return { ok: false, error: "answers_count" };
  const seen = new Set();
  for (const row of answers) {
    if (!row || typeof row !== "object") return { ok: false, error: "answer_shape" };
    const eid = Number(row.exerciseId);
    if (!Number.isInteger(eid) || eid < 1 || eid > MAX_EXERCISE_ID) {
      return { ok: false, error: "exercise_id_range" };
    }
    if (!expected.has(eid)) return { ok: false, error: "unexpected_exercise_id" };
    if (seen.has(eid)) return { ok: false, error: "duplicate_exercise_id" };
    seen.add(eid);
  }
  for (const eid of snap.exerciseIds) {
    if (!seen.has(eid)) return { ok: false, error: "missing_exercise_id" };
  }
  return { ok: true, publishedExerciseIds: snap.exerciseIds, quizRevision: snap.revision };
}

// ---------- Storage backends ----------

const useDb = DATABASE_URL !== "";
let pool = null;
if (useDb) {
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    // Neon (and most managed Postgres) require SSL. node-postgres handles it
    // when ?sslmode=require is on the URL, but we set this explicitly too.
    ssl: { rejectUnauthorized: false },
    max: 5,
  });
  pool.on("error", (err) => {
    console.error("pg pool error", err);
  });
}

async function dbEnsureSchema() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS submissions (
      id UUID PRIMARY KEY,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      participant_label TEXT,
      client_submitted_at TIMESTAMPTZ,
      user_agent TEXT,
      answers JSONB NOT NULL,
      graded JSONB NOT NULL,
      score_total INTEGER NOT NULL,
      score_max INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS submissions_received_at_idx ON submissions (received_at DESC);
  `);
  await pool.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS quiz_revision INTEGER`);
  await pool.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS published_exercise_ids JSONB`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS quiz_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      config JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function storageInsert(row) {
  if (pool) {
    await pool.query(
      `INSERT INTO submissions
        (id, received_at, participant_label, client_submitted_at, user_agent, answers, graded, score_total, score_max, quiz_revision, published_exercise_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        row.id,
        row.receivedAt,
        row.participantLabel,
        row.clientSubmittedAt,
        row.userAgent,
        JSON.stringify(row.answers),
        JSON.stringify(row.graded),
        row.scoreTotal,
        row.scoreMax,
        row.quizRevision ?? null,
        row.publishedExerciseIds != null ? JSON.stringify(row.publishedExerciseIds) : null,
      ],
    );
    return;
  }
  ensureDataDir();
  fs.appendFileSync(STORE, JSON.stringify(row) + "\n", "utf8");
}

async function storageList() {
  if (pool) {
    const { rows } = await pool.query(
      `SELECT id, received_at, participant_label, client_submitted_at, user_agent,
              answers, graded, score_total, score_max, quiz_revision, published_exercise_ids
         FROM submissions
        ORDER BY received_at DESC
        LIMIT 1000`,
    );
    return rows.map((r) => ({
      id: r.id,
      receivedAt: r.received_at instanceof Date ? r.received_at.toISOString() : r.received_at,
      participantLabel: r.participant_label,
      clientSubmittedAt:
        r.client_submitted_at instanceof Date ? r.client_submitted_at.toISOString() : r.client_submitted_at,
      userAgent: r.user_agent,
      answers: r.answers,
      graded: r.graded,
      scoreTotal: r.score_total,
      scoreMax: r.score_max,
      quizRevision: r.quiz_revision,
      publishedExerciseIds: r.published_exercise_ids,
    }));
  }
  ensureDataDir();
  if (!fs.existsSync(STORE)) return [];
  const raw = fs.readFileSync(STORE, "utf8").trim();
  if (!raw) return [];
  return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

// ---------- HTTP routes ----------

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "256kb" }));

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "html-basics-test",
    serverPackageVersion: "1.2.1",
    hasTeacherReviewPage: true,
    hasServerDrivenQuiz: true,
    teacherReviewPaths: ["/review", "/review.html", "/api/review", "/api/review.php"],
    studentQuizPaths: ["/api/quiz", "/api/quiz.php"],
    teacherNoCodeQuizSettings: "/manage-quiz?token=…",
  });
});
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/health.php", (_req, res) => res.json({ ok: true }));
app.get("/api/quiz", handleGetQuiz);
app.get("/api/quiz.php", handleGetQuiz);
app.get("/manage-quiz", handleGetManageQuiz);
app.post("/manage-quiz", handlePostManageQuiz);

async function handlePostSubmission(req, res) {
  const valid = validateBody(req.body);
  if (!valid.ok) return res.status(400).json({ ok: false, error: valid.error });
  try {
    const normalized = summarizeAnswers(req.body.answers);
    const { graded, scoreTotal, scoreMax } = gradeSubmission(normalized);
    const row = {
      id: crypto.randomUUID(),
      receivedAt: new Date().toISOString(),
      participantLabel: req.body?.participantLabel ?? null,
      clientSubmittedAt: req.body?.clientSubmittedAt ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      answers: normalized,
      graded,
      scoreTotal,
      scoreMax,
      quizRevision: valid.quizRevision,
      publishedExerciseIds: valid.publishedExerciseIds,
    };
    await storageInsert(row);
    res.json({ ok: true, id: row.id });
  } catch (e) {
    console.error("submit failed", e);
    res.status(500).json({ ok: false, error: "store_failed" });
  }
}

async function handleGetSubmissions(req, res) {
  const token = readRequestAdminToken(req);
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  try {
    const submissions = await storageList();
    res.json({ ok: true, submissions });
  } catch (e) {
    console.error("list failed", e);
    res.status(500).json({ ok: false, error: "read_failed" });
  }
}

async function handleGetReview(req, res) {
  const token = readRequestAdminToken(req);
  if (token !== ADMIN_TOKEN) {
    return res
      .status(401)
      .type("html")
      .send(
        "<!DOCTYPE html><html><head><meta charset='utf-8'/><title>Unauthorized</title></head><body><h1>Unauthorized</h1><p>Add <code>?token=…</code> or an <code>Authorization: Bearer …</code> header with your admin token.</p></body></html>",
      );
  }
  try {
    const submissions = await storageList();
    const html = buildReviewPageHtml(submissions);
    res.type("html").send(html);
  } catch (e) {
    console.error("review page failed", e);
    res
      .status(500)
      .type("html")
      .send("<!DOCTYPE html><html><body><h1>Server error</h1><p>Could not build review page.</p></body></html>");
  }
}

app.post("/api/submissions", handlePostSubmission);
app.post("/api/submissions.php", handlePostSubmission);
app.get("/api/submissions", handleGetSubmissions);
app.get("/api/submissions.php", handleGetSubmissions);
app.get("/review", handleGetReview);
app.get("/review.html", handleGetReview);
app.get("/api/review", handleGetReview);
app.get("/api/review.php", handleGetReview);

async function main() {
  if (pool) {
    try {
      await dbEnsureSchema();
      console.log("Postgres ready (schema ensured).");
    } catch (e) {
      console.error("Failed to ensure schema:", e);
      process.exit(1);
    }
  } else {
    console.log("No DATABASE_URL set — using local NDJSON storage at", STORE);
  }
  await refreshPublishConfigFromStorage();
  app.listen(PORT, () => {
    console.log(`HTML basics test server listening on ${PORT}`);
    const authHint =
      ADMIN_TOKEN === "devtoken"
        ? "devtoken (DEFAULT — set HTML_TEST_ADMIN_TOKEN in Render)"
        : `secret configured (${ADMIN_TOKEN.length} chars after trim)`;
    console.log(`Admin JSON: GET /api/submissions.php?token=… (${authHint})`);
    console.log("Admin review (HTML): GET /review?token=…");
    console.log("Student quiz JSON: GET /api/quiz.php");
    console.log("Teacher quiz settings (no code): GET /manage-quiz?token=…");
  });
}

main();
