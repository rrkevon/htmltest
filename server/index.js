/**
 * HTML basics test server.
 *
 * Storage:
 *   - When DATABASE_URL is set (Render + Neon Postgres), submissions go to the
 *     `submissions` table.
 *   - Otherwise, submissions are appended as JSON lines to data/submissions.ndjson
 *     (used for local development).
 *
 * Grading happens here, using answer_key.json. Each row gets `graded`,
 * `scoreTotal`, and `scoreMax` fields before being stored.
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

/** Query ?token=… or header Authorization: Bearer … (easier if the secret has URL-awkward characters). */
function readRequestAdminToken(req) {
  const fromQuery = readQueryToken(req.query);
  if (fromQuery) return fromQuery;
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return "";
}

const DATA_DIR = path.join(__dirname, "data");
const STORE = path.join(DATA_DIR, "submissions.ndjson");
const ANSWER_KEY_PATH = path.join(__dirname, "answer_key.json");
const QUIZ_CONTENT_PATH = path.join(__dirname, "quiz_content.json");
/** Must match ExerciseBank size and validateBody. */
const EXPECTED_QUESTION_COUNT = 30;

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

function loadQuizContent() {
  if (quizContentCache) return quizContentCache;
  const raw = fs.readFileSync(QUIZ_CONTENT_PATH, "utf8");
  const json = JSON.parse(raw);
  const out = {};
  for (const [k, v] of Object.entries(json)) {
    if (!k || k.startsWith("$")) continue;
    if (v && typeof v === "object") out[k] = v;
  }
  quizContentCache = out;
  return out;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
<strong>User agent</strong> ${escapeHtml(sub.userAgent ?? "")}
</div>`);

    const ansById = Object.fromEntries((sub.answers || []).map((a) => [String(a.exerciseId), a]));
    const gradeById = Object.fromEntries((sub.graded || []).map((g) => [String(g.exerciseId), g]));

    for (let i = 1; i <= EXPECTED_QUESTION_COUNT; i++) {
      const sid = String(i);
      const quizRow = quiz[sid] || {};
      const keyRow = key[sid];
      const ansRow = ansById[sid] || {};
      const gr = gradeById[sid];
      const correct = gr?.correct === true;
      const badge = correct ? '<span class="ok">Correct</span>' : '<span class="bad">Incorrect</span>';
      const title = escapeHtml(quizRow.title || `Question ${i}`);
      const prompt = escapeHtml(quizRow.prompt || "(no prompt in quiz_content.json — sync ExerciseBank.kt)");
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
<div class="qhead"><span class="qid">Q${i}</span> ${badge}<span style="color:var(--muted);font-size:0.88rem">${title}</span></div>
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
  if (answers.length !== EXPECTED_QUESTION_COUNT) {
    return { ok: false, error: "answers_count" };
  }
  const seen = new Set();
  for (const row of answers) {
    if (!row || typeof row !== "object") return { ok: false, error: "answer_shape" };
    const eid = Number(row.exerciseId);
    if (!Number.isInteger(eid) || eid < 1 || eid > EXPECTED_QUESTION_COUNT) {
      return { ok: false, error: "exercise_id_range" };
    }
    if (seen.has(eid)) return { ok: false, error: "duplicate_exercise_id" };
    seen.add(eid);
  }
  for (let i = 1; i <= EXPECTED_QUESTION_COUNT; i++) {
    if (!seen.has(i)) return { ok: false, error: "missing_exercise_id" };
  }
  return { ok: true };
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
}

async function storageInsert(row) {
  if (pool) {
    await pool.query(
      `INSERT INTO submissions
        (id, received_at, participant_label, client_submitted_at, user_agent, answers, graded, score_total, score_max)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
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
              answers, graded, score_total, score_max
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
app.use(express.json({ limit: "256kb" }));

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "html-basics-test" });
});
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/health.php", (_req, res) => res.json({ ok: true }));

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
  app.listen(PORT, () => {
    console.log(`HTML basics test server listening on ${PORT}`);
    const authHint =
      ADMIN_TOKEN === "devtoken"
        ? "devtoken (DEFAULT — set HTML_TEST_ADMIN_TOKEN in Render)"
        : `secret configured (${ADMIN_TOKEN.length} chars after trim)`;
    console.log(`Admin JSON: GET /api/submissions.php?token=… (${authHint})`);
    console.log("Admin review (HTML): GET /review?token=…");
  });
}

main();
