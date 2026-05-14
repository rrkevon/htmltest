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
const ADMIN_TOKEN = process.env.HTML_TEST_ADMIN_TOKEN || "devtoken";
const DATABASE_URL = process.env.DATABASE_URL || "";

const DATA_DIR = path.join(__dirname, "data");
const STORE = path.join(DATA_DIR, "submissions.ndjson");
const ANSWER_KEY_PATH = path.join(__dirname, "answer_key.json");

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

const EXPECTED_QUESTION_COUNT = 30;

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
  const token = String(req.query.token || "");
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

app.post("/api/submissions", handlePostSubmission);
app.post("/api/submissions.php", handlePostSubmission);
app.get("/api/submissions", handleGetSubmissions);
app.get("/api/submissions.php", handleGetSubmissions);

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
    console.log(`Admin: GET /api/submissions.php?token=${ADMIN_TOKEN === "devtoken" ? "devtoken (DEFAULT, change me!)" : "***"}`);
  });
}

main();
