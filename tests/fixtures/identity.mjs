// A copy of the suite's identity tables and each app's role names, for the tests: IDENTITY_SCHEMA and SUITE_APPS from
// lib/identity/people.js, the same file in every engagement app. Provisioning reads the real one from the app checkout
// at run time. tests/people.test.mjs compares this copy with an app checkout when one is beside this repo (or APP_DIR).
export const IDENTITY_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS people (\n    id TEXT PRIMARY KEY,\n    email TEXT NOT NULL UNIQUE,\n    name TEXT NOT NULL DEFAULT '',\n    organisation TEXT NOT NULL DEFAULT '',\n    pending_email TEXT,\n    date_format TEXT,\n    time_zone TEXT,\n    notify_email INTEGER NOT NULL DEFAULT 1,\n    created_at TEXT NOT NULL,\n    created_by TEXT NOT NULL,\n    updated_at TEXT NOT NULL,\n    updated_by TEXT NOT NULL\n  )",
  "CREATE TABLE IF NOT EXISTS memberships (\n    app TEXT NOT NULL,\n    local_id TEXT NOT NULL,\n    person_id TEXT NOT NULL,\n    roles TEXT NOT NULL DEFAULT '',\n    is_admin INTEGER NOT NULL DEFAULT 0,\n    active INTEGER NOT NULL DEFAULT 1,\n    created_at TEXT NOT NULL,\n    created_by TEXT NOT NULL,\n    updated_at TEXT NOT NULL,\n    updated_by TEXT NOT NULL,\n    last_seen_at TEXT,\n    PRIMARY KEY (app, local_id),\n    UNIQUE (app, person_id)\n  )",
  "CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS memberships_person ON memberships (person_id)"
];
export const SUITE_APPS = [
  {
    "id": "risk-appetite",
    "name": "AI Risk Appetite",
    "roles": {
      "counsel": "Counsel (facilitator)",
      "gc": "General counsel (client)",
      "triodian": "Triodian (recorder)",
      "cro": "CRO",
      "risk": "Risk function",
      "independent": "Independent reviewer",
      "board": "Board record"
    }
  },
  {
    "id": "use-assessment",
    "name": "AI Use Assessment",
    "roles": {
      "methodOwner": "Method owner (Triodian)",
      "assessor": "Assessor (Triodian)",
      "peer": "Peer reviewer (Triodian)",
      "validation": "Validation (Triodian)",
      "delivery": "Delivery manager (Triodian)",
      "counsel": "Counsel",
      "gc": "GC",
      "owner": "Arrangement owner (client)",
      "ir": "Independent reviewer",
      "cro": "CRO (client)",
      "executive": "Second approver (company executive)"
    }
  },
  {
    "id": "confidentiality",
    "name": "AI Confidentiality Exposure Assessment",
    "roles": {
      "methodOwner": "Method owner (Triodian)",
      "assessor": "Assessor (Triodian)",
      "peer": "Classification reviewer (Triodian)",
      "validation": "Validation (Triodian)",
      "delivery": "Delivery manager (Triodian)",
      "counsel": "Counsel (law firm)",
      "gc": "GC or approving executive (company)",
      "dealLead": "Deal team lead (company)",
      "tenantOwner": "Tenant owner (company)",
      "checker": "Independent checker",
      "executive": "Second approver (company executive)"
    }
  },
  {
    "id": "board-direction",
    "name": "AI Board Direction",
    "roles": {
      "methodOwner": "Method owner (Triodian)",
      "recorder": "Recorder (Triodian)",
      "advisor": "Board advisor",
      "gc": "General counsel",
      "chair": "Chair (board)",
      "director": "Director (board)",
      "ceo": "CEO or accountable executive (company)",
      "cro": "CRO (company, connected mode)",
      "areaOwner": "Area owner (company)"
    }
  }
];
