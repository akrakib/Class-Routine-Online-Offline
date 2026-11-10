const SESSION_DAYS = 7;
const PASSWORD_ITERATIONS = 100000;

const DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday"
];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// ------------------------------
// RESPONSE
// ------------------------------

function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

function bad(message, cors, status = 400) {
  return json({ success: false, message }, status, cors);
}

// ------------------------------
// CORS SECURITY
// ------------------------------

function getCorsHeaders(request, env, path) {
  // Public read-only API: any origin (Android app, web).
  if (path.startsWith("/api/public/")) {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400"
    };
  }

  const origin = request.headers.get("Origin");

  if (!origin || !env.ADMIN_ORIGIN || origin !== env.ADMIN_ORIGIN) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Bootstrap-Secret",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

// ------------------------------
// ENCODING & RANDOM
// ------------------------------

function encode(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function decode(value) {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const binary = atob(
    base64 + "=".repeat((4 - base64.length % 4) % 4)
  );

  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

// ------------------------------
// SECURE COMPARISON
// ------------------------------

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;

  let difference = 0;

  for (let i = 0; i < a.length; i++) {
    difference |= a[i] ^ b[i];
  }

  return difference === 0;
}

// ------------------------------
// SHA-256
// ------------------------------

async function digest(value) {
  const result = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );

  return encode(new Uint8Array(result));
}

// ------------------------------
// PASSWORD HASHING
// ------------------------------

async function hashPassword(password, salt = randomBytes(16)) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PASSWORD_ITERATIONS,
      hash: "SHA-256"
    },
    key,
    256
  );

  return [
    "pbkdf2",
    PASSWORD_ITERATIONS,
    encode(salt),
    encode(new Uint8Array(bits))
  ].join("$");
}

async function verifyPassword(password, stored) {
  try {
    const parts = stored.split("$");

    if (
      parts.length !== 4 ||
      parts[0] !== "pbkdf2" ||
      Number(parts[1]) !== PASSWORD_ITERATIONS
    ) {
      return false;
    }

    const salt = decode(parts[2]);
    const expected = decode(parts[3]);

    if (salt.length !== 16 || expected.length !== 32) {
      return false;
    }

    const generated = await hashPassword(password, salt);
    const actual = decode(generated.split("$")[3]);

    return constantTimeEqual(actual, expected);

  } catch {
    return false;
  }
}

// ------------------------------
// SESSION CREATION
// ------------------------------

async function createSession(env, adminId) {
  const token = encode(randomBytes(32));
  const tokenHash = await digest(token);

  const now = new Date();

  const expiresAt = new Date(
    now.getTime() + SESSION_DAYS * 86400000
  ).toISOString();

  // Remove expired sessions.
  await env.DB.prepare(`
    DELETE FROM admin_sessions WHERE expires_at <= ?
  `).bind(now.toISOString()).run();

  await env.DB.prepare(`
    INSERT INTO admin_sessions
      (admin_id, token_hash, expires_at)
    VALUES (?, ?, ?)
  `).bind(adminId, tokenHash, expiresAt).run();

  return {
    token,
    expiresAt
  };
}

// ------------------------------
// AUTHENTICATION
// ------------------------------

async function authenticate(request, env) {
  const authorization =
    request.headers.get("Authorization") || "";

  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice(7);

  if (!token || token.length > 200) {
    return null;
  }

  const tokenHash = await digest(token);

  return await env.DB.prepare(`
    SELECT
      admin_users.id,
      admin_users.username
    FROM admin_sessions
    JOIN admin_users
      ON admin_users.id = admin_sessions.admin_id
    WHERE admin_sessions.token_hash = ?
      AND admin_sessions.expires_at > ?
  `).bind(
    tokenHash,
    new Date().toISOString()
  ).first();
}

// ------------------------------
// LOGIN RATE LIMIT
// ------------------------------

async function loginRateLimit(env, request) {
  const ip =
    request.headers.get("CF-Connecting-IP") || "unknown";

  // Store a hash rather than the raw IP address.
  const identifier = "ip:" + await digest(ip);

  const now = Math.floor(Date.now() / 1000);

  const row = await env.DB.prepare(`
    SELECT attempts, window_start, blocked_until
    FROM admin_login_attempts
    WHERE identifier = ?
  `).bind(identifier).first();

  if (row && row.blocked_until > now) {
    return false;
  }

  const reset =
    !row || now - row.window_start >= 900;

  const attempts = reset ? 1 : row.attempts + 1;
  const windowStart = reset ? now : row.window_start;

  const blockedUntil =
    attempts >= 5 ? now + 900 : 0;

  await env.DB.prepare(`
    INSERT INTO admin_login_attempts
      (identifier, attempts, window_start, blocked_until)
    VALUES (?, ?, ?, ?)

    ON CONFLICT(identifier) DO UPDATE SET
      attempts = excluded.attempts,
      window_start = excluded.window_start,
      blocked_until = excluded.blocked_until
  `).bind(
    identifier,
    attempts,
    windowStart,
    blockedUntil
  ).run();

  // The fifth attempt is allowed.
  // Further attempts are blocked for 15 minutes.
  return attempts <= 5;
}

// ------------------------------
// REQUEST HELPERS
// ------------------------------

async function readJson(request) {
  try {
    const body = await request.json();

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return null;
    }

    return body;
  } catch {
    return null;
  }
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const d = new Date(value + "T00:00:00Z");

  return !Number.isNaN(d.getTime()) &&
    d.toISOString().slice(0, 10) === value;
}

function positiveId(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const n = Number(value);

  return Number.isInteger(n) && n >= 1 ? n : NaN;
}

// Validates a body against a list of field rules.
function cleanFields(fields, body) {
  const out = {};

  for (const f of fields) {
    let v = body[f.name];

    if (f.type === "bool") {
      if (v === undefined) v = f.def ?? false;

      if (typeof v !== "boolean") {
        return { error: `${f.name} must be true or false` };
      }

      out[f.name] = v ? 1 : 0;
      continue;
    }

    if (f.type === "int") {
      const n = positiveId(v);

      if (n === null || Number.isNaN(n)) {
        return { error: `${f.name} must be a valid id` };
      }

      out[f.name] = n;
      continue;
    }

    v = v === null || v === undefined ? "" : String(v).trim();

    if (!v) {
      if (f.required) return { error: `${f.name} is required` };
      out[f.name] = null;
      continue;
    }

    if (v.length > f.max) {
      return { error: `${f.name} is too long (max ${f.max})` };
    }

    if (f.type === "date" && !validDate(v)) {
      return { error: `${f.name} must be a valid date (YYYY-MM-DD)` };
    }

    out[f.name] = v;
  }

  return { values: out };
}

// ------------------------------
// DATABASE WRITE HELPERS
// ------------------------------

// Every change bumps the version so the student app knows to refresh.
function bumpVersion(env) {
  return env.DB.prepare(`
    INSERT INTO publish_state (id, version, published_at)
    VALUES (1, 1, ?)
    ON CONFLICT(id) DO UPDATE SET
      version = version + 1,
      published_at = excluded.published_at
  `).bind(new Date().toISOString());
}

async function write(env, statements, kind, cors) {
  try {
    const results = await env.DB.batch([
      ...statements,
      bumpVersion(env)
    ]);

    return { results };

  } catch (error) {
    const message = String((error && error.message) || error);

    if (message.includes("UNIQUE")) {
      return {
        response: bad("This item already exists", cors, 409)
      };
    }

    if (message.includes("FOREIGN KEY")) {
      return kind === "delete"
        ? {
          response: bad(
            "This item is in use and cannot be deleted",
            cors,
            409
          )
        }
        : {
          response: bad(
            "A referenced semester, group, subject, teacher or room does not exist",
            cors,
            400
          )
        };
    }

    throw error;
  }
}

// ------------------------------
// SIMPLE RESOURCES
// ------------------------------

const RESOURCES = {
  semesters: {
    table: "semesters",
    order: "id",
    fields: [
      { name: "name", type: "text", max: 60, required: true },
      { name: "is_active", type: "bool", def: true }
    ]
  },
  groups: {
    table: "groups",
    order: "semester_id, name",
    fields: [
      { name: "semester_id", type: "int" },
      { name: "name", type: "text", max: 30, required: true },
      { name: "is_active", type: "bool", def: true }
    ]
  },
  subjects: {
    table: "subjects",
    order: "name",
    fields: [
      { name: "name", type: "text", max: 120, required: true }
    ]
  },
  teachers: {
    table: "teachers",
    order: "name",
    fields: [
      { name: "name", type: "text", max: 100, required: true },
      { name: "phone", type: "text", max: 30, required: false }
    ]
  },
  rooms: {
    table: "rooms",
    order: "name",
    fields: [
      { name: "name", type: "text", max: 40, required: true }
    ]
  },
  announcements: {
    table: "announcements",
    order: "id DESC",
    fields: [
      { name: "title", type: "text", max: 160, required: true },
      { name: "content", type: "text", max: 3000, required: true },
      { name: "is_published", type: "bool", def: false }
    ]
  },
  events: {
    table: "academic_events",
    order: "event_date, id",
    fields: [
      { name: "title", type: "text", max: 160, required: true },
      { name: "event_date", type: "date", max: 10, required: true },
      { name: "description", type: "text", max: 1000, required: false },
      { name: "is_published", type: "bool", def: false }
    ]
  }
};

async function resourceApi(request, env, name, id, cors) {
  const spec = RESOURCES[name];
  const method = request.method;
  const table = `"${spec.table}"`;

  // LIST
  if (id === null && method === "GET") {
    const result = await env.DB.prepare(
      `SELECT * FROM ${table} ORDER BY ${spec.order}`
    ).all();

    return json({ success: true, items: result.results }, 200, cors);
  }

  // CREATE
  if (id === null && method === "POST") {
    const body = await readJson(request);
    if (!body) return bad("Invalid JSON body", cors);

    const cleaned = cleanFields(spec.fields, body);
    if (cleaned.error) return bad(cleaned.error, cors);

    const cols = spec.fields.map(f => f.name);

    const stmt = env.DB.prepare(`
      INSERT INTO ${table} (${cols.join(", ")})
      VALUES (${cols.map(() => "?").join(", ")})
    `).bind(...cols.map(c => cleaned.values[c]));

    const done = await write(env, [stmt], "write", cors);
    if (done.response) return done.response;

    return json({
      success: true,
      id: done.results[0].meta.last_row_id
    }, 201, cors);
  }

  if (id !== null && method === "GET") {
    const row = await env.DB.prepare(
      `SELECT * FROM ${table} WHERE id = ?`
    ).bind(id).first();

    if (!row) return bad("Not found", cors, 404);

    return json({ success: true, item: row }, 200, cors);
  }

  // UPDATE
  if (id !== null && method === "PUT") {
    const body = await readJson(request);
    if (!body) return bad("Invalid JSON body", cors);

    const cleaned = cleanFields(spec.fields, body);
    if (cleaned.error) return bad(cleaned.error, cors);

    const cols = spec.fields.map(f => f.name);

    const stmt = env.DB.prepare(`
      UPDATE ${table}
      SET ${cols.map(c => `${c} = ?`).join(", ")}
      WHERE id = ?
    `).bind(...cols.map(c => cleaned.values[c]), id);

    const done = await write(env, [stmt], "write", cors);
    if (done.response) return done.response;

    if (done.results[0].meta.changes !== 1) {
      return bad("Not found", cors, 404);
    }

    return json({ success: true, message: "Updated successfully" }, 200, cors);
  }

  // DELETE
  if (id !== null && method === "DELETE") {
    const stmt = env.DB.prepare(
      `DELETE FROM ${table} WHERE id = ?`
    ).bind(id);

    const done = await write(env, [stmt], "delete", cors);
    if (done.response) return done.response;

    if (done.results[0].meta.changes !== 1) {
      return bad("Not found", cors, 404);
    }

    return json({ success: true, message: "Deleted successfully" }, 200, cors);
  }

  return bad("Method not allowed", cors, 405);
}

// ------------------------------
// ROUTINES
// ------------------------------

const DAY_ORDER_SQL =
  "CASE r.day " +
  DAYS.map((d, i) => `WHEN '${d}' THEN ${i}`).join(" ") +
  " ELSE 7 END";

const ROUTINE_SELECT = `
  SELECT
    r.id,
    r.group_id,
    g.name AS group_name,
    sem.name AS semester_name,
    r.subject_id,
    s.name AS subject_name,
    r.teacher_id,
    t.name AS teacher_name,
    t.phone AS teacher_phone,
    r.room_id,
    rm.name AS room_name,
    r.day,
    r.start_time,
    r.end_time,
    r.is_published,
    r.updated_at
  FROM class_routines r
  JOIN "groups" g ON g.id = r.group_id
  JOIN semesters sem ON sem.id = g.semester_id
  LEFT JOIN subjects s ON s.id = r.subject_id
  LEFT JOIN teachers t ON t.id = r.teacher_id
  LEFT JOIN rooms rm ON rm.id = r.room_id
`;

const ROUTINE_ORDER =
  ` ORDER BY ${DAY_ORDER_SQL}, r.start_time`;

function cleanRoutine(body) {
  const groupId = positiveId(body.group_id);
  const subjectId = positiveId(body.subject_id);
  const teacherId = positiveId(body.teacher_id);
  const roomId = positiveId(body.room_id);

  const day = DAYS.find(
    d => d.toLowerCase() ===
      String(body.day || "").trim().toLowerCase()
  );

  const startTime = String(body.start_time || "");
  const endTime = String(body.end_time || "");
  const isPublished = body.is_published ?? false;

  if (
    groupId === null || Number.isNaN(groupId) ||
    subjectId === null || Number.isNaN(subjectId) ||
    Number.isNaN(teacherId) ||
    Number.isNaN(roomId) ||
    !day ||
    !TIME_RE.test(startTime) ||
    !TIME_RE.test(endTime) ||
    startTime >= endTime ||
    typeof isPublished !== "boolean"
  ) {
    return { error: "Invalid routine data" };
  }

  return {
    values: {
      group_id: groupId,
      subject_id: subjectId,
      teacher_id: teacherId,
      room_id: roomId,
      day,
      start_time: startTime,
      end_time: endTime,
      is_published: isPublished ? 1 : 0
    }
  };
}

// Same group, same teacher or same room cannot overlap.
async function findConflict(env, v, excludeId) {
  const row = await env.DB.prepare(`
    SELECT group_id, teacher_id, room_id
    FROM class_routines
    WHERE day = ?
      AND start_time < ?
      AND end_time > ?
      AND id != ?
      AND (group_id = ? OR teacher_id = ? OR room_id = ?)
    LIMIT 1
  `).bind(
    v.day,
    v.end_time,
    v.start_time,
    excludeId,
    v.group_id,
    v.teacher_id,
    v.room_id
  ).first();

  if (!row) return null;

  if (row.group_id === v.group_id) {
    return "This group already has a class at this time";
  }

  if (v.teacher_id !== null && row.teacher_id === v.teacher_id) {
    return "This teacher already has a class at this time";
  }

  return "This room is already used at this time";
}

async function routineApi(request, env, id, url, cors) {
  const method = request.method;

  // LIST
  if (id === null && method === "GET") {
    const groupId = positiveId(url.searchParams.get("group_id"));

    if (Number.isNaN(groupId)) {
      return bad("Invalid group_id", cors);
    }

    const result = await env.DB.prepare(`
      ${ROUTINE_SELECT}
      WHERE (? IS NULL OR r.group_id = ?)
      ${ROUTINE_ORDER}
    `).bind(groupId, groupId).all();

    return json({
      success: true,
      routines: result.results
    }, 200, cors);
  }

  // CREATE
  if (id === null && method === "POST") {
    const body = await readJson(request);
    if (!body) return bad("Invalid JSON body", cors);

    const cleaned = cleanRoutine(body);
    if (cleaned.error) return bad(cleaned.error, cors);

    const v = cleaned.values;

    const conflict = await findConflict(env, v, 0);
    if (conflict) return bad(conflict, cors, 409);

    const stmt = env.DB.prepare(`
      INSERT INTO class_routines
        (group_id, subject_id, teacher_id, room_id,
         day, start_time, end_time, is_published)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      v.group_id, v.subject_id, v.teacher_id, v.room_id,
      v.day, v.start_time, v.end_time, v.is_published
    );

    const done = await write(env, [stmt], "write", cors);
    if (done.response) return done.response;

    return json({
      success: true,
      message: "Routine created successfully",
      id: done.results[0].meta.last_row_id
    }, 201, cors);
  }

  if (id !== null && method === "GET") {
    const row = await env.DB.prepare(`
      ${ROUTINE_SELECT} WHERE r.id = ?
    `).bind(id).first();

    if (!row) return bad("Routine not found", cors, 404);

    return json({ success: true, routine: row }, 200, cors);
  }

  // UPDATE
  if (id !== null && method === "PUT") {
    const body = await readJson(request);
    if (!body) return bad("Invalid JSON body", cors);

    const cleaned = cleanRoutine(body);
    if (cleaned.error) return bad(cleaned.error, cors);

    const v = cleaned.values;

    const conflict = await findConflict(env, v, id);
    if (conflict) return bad(conflict, cors, 409);

    const stmt = env.DB.prepare(`
      UPDATE class_routines
      SET
        group_id = ?,
        subject_id = ?,
        teacher_id = ?,
        room_id = ?,
        day = ?,
        start_time = ?,
        end_time = ?,
        is_published = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      v.group_id, v.subject_id, v.teacher_id, v.room_id,
      v.day, v.start_time, v.end_time, v.is_published,
      id
    );

    const done = await write(env, [stmt], "write", cors);
    if (done.response) return done.response;

    if (done.results[0].meta.changes !== 1) {
      return bad("Routine not found", cors, 404);
    }

    return json({
      success: true,
      message: "Routine updated successfully"
    }, 200, cors);
  }

  // DELETE
  if (id !== null && method === "DELETE") {
    const stmt = env.DB.prepare(
      "DELETE FROM class_routines WHERE id = ?"
    ).bind(id);

    const done = await write(env, [stmt], "delete", cors);
    if (done.response) return done.response;

    if (done.results[0].meta.changes !== 1) {
      return bad("Routine not found", cors, 404);
    }

    return json({
      success: true,
      message: "Routine deleted successfully"
    }, 200, cors);
  }

  return bad("Method not allowed", cors, 405);
}

// ------------------------------
// ADMIN API (login required)
// ------------------------------

async function adminApi(request, env, url, cors) {
  const path = url.pathname;

  // Publish all draft routines (optionally for one group).
  if (path === "/api/admin/publish") {
    if (request.method !== "POST") {
      return bad("Method not allowed", cors, 405);
    }

    const body = (await readJson(request)) || {};
    const groupId = positiveId(body.group_id);

    if (Number.isNaN(groupId)) {
      return bad("Invalid group_id", cors);
    }

    const stmt = env.DB.prepare(`
      UPDATE class_routines
      SET is_published = 1, updated_at = CURRENT_TIMESTAMP
      WHERE is_published = 0
        AND (? IS NULL OR group_id = ?)
    `).bind(groupId, groupId);

    const done = await write(env, [stmt], "write", cors);
    if (done.response) return done.response;

    return json({
      success: true,
      message: "Routine published",
      published_count: done.results[0].meta.changes
    }, 200, cors);
  }

  const match = path.match(
    /^\/api\/admin\/(routines|semesters|groups|subjects|teachers|rooms|announcements|events)(?:\/(\d+))?$/
  );

  if (!match) {
    return bad("API endpoint not found", cors, 404);
  }

  const name = match[1];
  const id = match[2] ? Number(match[2]) : null;

  if (name === "routines") {
    return routineApi(request, env, id, url, cors);
  }

  return resourceApi(request, env, name, id, cors);
}

// ------------------------------
// PUBLIC API (students, no login)
// ------------------------------

async function publicApi(request, env, url, cors) {
  const path = url.pathname;

  if (path === "/api/public/version") {
    const state = await env.DB.prepare(
      "SELECT version, published_at FROM publish_state WHERE id = 1"
    ).first();

    return json({
      success: true,
      version: state ? state.version : 0,
      published_at: state ? state.published_at : null
    }, 200, cors);
  }

  if (path === "/api/public/groups") {
    const result = await env.DB.prepare(`
      SELECT
        g.id,
        g.name,
        g.semester_id,
        sem.name AS semester_name
      FROM "groups" g
      JOIN semesters sem ON sem.id = g.semester_id
      WHERE g.is_active = 1 AND sem.is_active = 1
      ORDER BY sem.name, g.name
    `).all();

    return json({ success: true, groups: result.results }, 200, cors);
  }

  if (path === "/api/public/routine") {
    const groupId = positiveId(url.searchParams.get("group_id"));

    if (groupId === null || Number.isNaN(groupId)) {
      return bad("group_id is required", cors);
    }

    const group = await env.DB.prepare(`
      SELECT g.id, g.name, sem.name AS semester_name
      FROM "groups" g
      JOIN semesters sem ON sem.id = g.semester_id
      WHERE g.id = ? AND g.is_active = 1 AND sem.is_active = 1
    `).bind(groupId).first();

    if (!group) return bad("Group not found", cors, 404);

    const routines = await env.DB.prepare(`
      ${ROUTINE_SELECT}
      WHERE r.group_id = ? AND r.is_published = 1
      ${ROUTINE_ORDER}
    `).bind(groupId).all();

    const state = await env.DB.prepare(
      "SELECT version, published_at FROM publish_state WHERE id = 1"
    ).first();

    return json({
      success: true,
      group,
      version: state ? state.version : 0,
      published_at: state ? state.published_at : null,
      routines: routines.results
    }, 200, cors);
  }

  if (path === "/api/public/announcements") {
    const result = await env.DB.prepare(`
      SELECT id, title, content, created_at
      FROM announcements
      WHERE is_published = 1
      ORDER BY id DESC
      LIMIT 50
    `).all();

    return json({ success: true, announcements: result.results }, 200, cors);
  }

  if (path === "/api/public/events") {
    const result = await env.DB.prepare(`
      SELECT id, title, event_date, description
      FROM academic_events
      WHERE is_published = 1
      ORDER BY event_date, id
      LIMIT 200
    `).all();

    return json({ success: true, events: result.results }, 200, cors);
  }

  return bad("API endpoint not found", cors, 404);
}

// ------------------------------
// MAIN WORKER
// ------------------------------

export default {

  async fetch(request, env) {

    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = getCorsHeaders(request, env, path);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    try {

      if (!env.DB) {
        return json({
          success: false,
          message: "Database binding DB missing"
        }, 500, corsHeaders);
      }

      // --------------------------
      // API STATUS
      // --------------------------

      if (
        path === "/" &&
        request.method === "GET"
      ) {
        return json({
          app: "Class Routine 2.0",
          status: "Online",
          database: "Connected",
          authentication: "Enabled"
        }, 200, corsHeaders);
      }

      // --------------------------
      // PUBLIC API
      // --------------------------

      if (path.startsWith("/api/public/")) {
        if (request.method !== "GET") {
          return bad("Method not allowed", corsHeaders, 405);
        }

        return await publicApi(request, env, url, corsHeaders);
      }

      // --------------------------
      // FIRST ADMIN SETUP
      // --------------------------

      if (
        path === "/api/admin/bootstrap" &&
        request.method === "POST"
      ) {

        const suppliedSecret =
          request.headers.get("X-Bootstrap-Secret") || "";

        const configuredSecret =
          env.BOOTSTRAP_SECRET || "";

        if (
          !configuredSecret ||
          suppliedSecret.length > 200
        ) {
          return json({
            success: false,
            message: "Invalid setup credentials"
          }, 401, corsHeaders);
        }

        const secretMatch = constantTimeEqual(
          new TextEncoder().encode(suppliedSecret),
          new TextEncoder().encode(configuredSecret)
        );

        if (!secretMatch) {
          return json({
            success: false,
            message: "Invalid setup credentials"
          }, 401, corsHeaders);
        }

        const body = await readJson(request);

        if (!body) {
          return bad("Invalid JSON body", corsHeaders);
        }

        const username =
          String(body.username || "").trim();

        const password =
          String(body.password || "");

        if (
          !/^[a-zA-Z0-9_.-]{3,32}$/.test(username) ||
          password.length < 12 ||
          password.length > 128
        ) {
          return json({
            success: false,
            message:
              "Username must be 3-32 characters and password 12-128 characters"
          }, 400, corsHeaders);
        }

        const passwordHash =
          await hashPassword(password);

        // Only one initial admin can be created.
        const result = await env.DB.prepare(`
          INSERT INTO admin_users (username, password_hash)
          SELECT ?, ?
          WHERE NOT EXISTS (
            SELECT 1 FROM admin_users
          )
        `).bind(username, passwordHash).run();

        if (!result.meta || result.meta.changes !== 1) {
          return json({
            success: false,
            message: "Admin already initialized"
          }, 409, corsHeaders);
        }

        return json({
          success: true,
          message: "First admin created successfully"
        }, 201, corsHeaders);
      }

      // --------------------------
      // ADMIN LOGIN
      // --------------------------

      if (
        path === "/api/admin/login" &&
        request.method === "POST"
      ) {

        const body = await readJson(request);

        if (!body) {
          return bad("Invalid JSON body", corsHeaders);
        }

        const username =
          String(body.username || "").trim();

        const password =
          String(body.password || "");

        if (
          username.length < 3 ||
          username.length > 32 ||
          password.length > 128
        ) {
          return json({
            success: false,
            message: "Invalid username or password"
          }, 400, corsHeaders);
        }

        const allowed =
          await loginRateLimit(env, request);

        if (!allowed) {
          return json({
            success: false,
            message: "Too many attempts. Try again in 15 minutes."
          }, 429, corsHeaders);
        }

        const admin = await env.DB.prepare(`
          SELECT id, username, password_hash
          FROM admin_users
          WHERE username = ?
        `).bind(username).first();

        if (
          !admin ||
          !(await verifyPassword(password, admin.password_hash))
        ) {
          return json({
            success: false,
            message: "Invalid username or password"
          }, 401, corsHeaders);
        }

        const ip =
          request.headers.get("CF-Connecting-IP") || "unknown";

        const identifier = "ip:" + await digest(ip);

        await env.DB.prepare(`
          DELETE FROM admin_login_attempts
          WHERE identifier = ?
        `).bind(identifier).run();

        const session =
          await createSession(env, admin.id);

        return json({
          success: true,
          admin: {
            id: admin.id,
            username: admin.username
          },
          token: session.token,
          expiresAt: session.expiresAt
        }, 200, corsHeaders);
      }

      // --------------------------
      // CURRENT ADMIN
      // --------------------------

      if (
        path === "/api/admin/me" &&
        request.method === "GET"
      ) {

        const admin =
          await authenticate(request, env);

        if (!admin) {
          return json({
            success: false,
            message: "Unauthorized"
          }, 401, corsHeaders);
        }

        return json({
          success: true,
          admin
        }, 200, corsHeaders);
      }

      // --------------------------
      // ADMIN LOGOUT
      // --------------------------

      if (
        path === "/api/admin/logout" &&
        request.method === "POST"
      ) {

        const authorization =
          request.headers.get("Authorization") || "";

        if (authorization.startsWith("Bearer ")) {

          const token =
            authorization.slice(7);

          if (token && token.length <= 200) {
            const tokenHash = await digest(token);

            await env.DB.prepare(`
              DELETE FROM admin_sessions
              WHERE token_hash = ?
            `).bind(tokenHash).run();
          }
        }

        return json({
          success: true,
          message: "Logged out successfully"
        }, 200, corsHeaders);
      }

      // --------------------------
      // DATABASE CHECK
      // --------------------------

      if (
        path === "/api/db-check" &&
        request.method === "GET"
      ) {

        await env.DB.prepare(
          "SELECT 1 AS connected"
        ).first();

        return json({
          success: true,
          database: "Connected"
        }, 200, corsHeaders);
      }

      // --------------------------
      // PROTECTED ADMIN API
      // --------------------------

      if (path.startsWith("/api/admin/")) {

        const admin =
          await authenticate(request, env);

        if (!admin) {
          return json({
            success: false,
            message: "Unauthorized"
          }, 401, corsHeaders);
        }

        return await adminApi(request, env, url, corsHeaders);
      }

      // --------------------------
      // UNKNOWN API
      // --------------------------

      return json({
        success: false,
        message: "API endpoint not found"
      }, 404, corsHeaders);

    } catch (error) {

      console.error("Worker error:", error);

      return json({
        success: false,
        message: "Internal server error"
      }, 500, corsHeaders);
    }
  }
};
