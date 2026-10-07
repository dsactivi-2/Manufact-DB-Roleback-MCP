-- Nur fuer das isolierte Testschema. Nicht auf defaultdb anwenden.
CREATE TABLE rb_synth_candidate (
  candidate_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  telephone VARCHAR(64) NULL,
  address VARCHAR(255) NULL,
  fee DECIMAL(12,2) NULL,
  external_no BIGINT NULL,
  PRIMARY KEY (candidate_id)
) ENGINE=InnoDB;
