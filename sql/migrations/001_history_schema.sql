-- Versionierte History-Tabellen. Nicht gegen Aiven ausgefuehrt.
-- Aendert keine bestehenden CRM-Tabellen. DDL kann implizit committen.
CREATE TABLE rb_entity_state (
  entity_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  entity_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  baseline_at DATETIME(6) NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
) ENGINE=InnoDB;

CREATE TABLE rb_field_state (
  entity_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  entity_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  field_name VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (entity_type, entity_id, field_name),
  FOREIGN KEY (entity_type, entity_id) REFERENCES rb_entity_state(entity_type, entity_id)
) ENGINE=InnoDB;

CREATE TABLE rb_baselines (
  baseline_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  entity_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  entity_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision BIGINT UNSIGNED NOT NULL,
  captured_at DATETIME(6) NOT NULL,
  typed_values JSON NOT NULL,
  PRIMARY KEY (baseline_id),
  UNIQUE KEY baseline_version (entity_type, entity_id, revision)
) ENGINE=InnoDB;

CREATE TABLE rb_events (
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  entity_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  entity_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision_before BIGINT UNSIGNED NOT NULL,
  revision_after BIGINT UNSIGNED NOT NULL,
  operation VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_issuer VARCHAR(255) NOT NULL,
  actor_subject VARCHAR(255) NOT NULL,
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(6) NOT NULL,
  typed_changes JSON NOT NULL,
  reason TEXT NOT NULL,
  event_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (event_id),
  UNIQUE KEY entity_revision (entity_type, entity_id, revision_after),
  KEY entity_time (entity_type, entity_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE rb_requests (
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  principal_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operation VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  idempotency_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result_json JSON NULL,
  created_at DATETIME(6) NOT NULL,
  completed_at DATETIME(6) NULL,
  PRIMARY KEY (request_id),
  UNIQUE KEY principal_request (principal_hash, operation, idempotency_key)
) ENGINE=InnoDB;

CREATE TABLE rb_outbox (
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(6) NOT NULL,
  lease_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  lease_until DATETIME(6) NULL,
  archived_at DATETIME(6) NULL,
  PRIMARY KEY (event_id),
  KEY due_events (status, next_attempt_at),
  FOREIGN KEY (event_id) REFERENCES rb_events(event_id)
) ENGINE=InnoDB;

CREATE TABLE rb_approvals (
  approval_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  principal_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  preview_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  preview_json JSON NOT NULL,
  decision VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
  decision_by VARCHAR(255) NULL,
  decided_at DATETIME(6) NULL,
  expires_at DATETIME(6) NOT NULL,
  consumed_by_request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  PRIMARY KEY (approval_id)
) ENGINE=InnoDB;
