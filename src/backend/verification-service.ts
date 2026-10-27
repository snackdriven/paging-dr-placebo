import { SCHEMA_VERSION, type VerificationSession } from '../types/schemas.js';
import { ControllableClock } from '../utils/clock.js';
import { SchedulingDatabase } from './database.js';

export interface VerifyPatientInput {
  conversationId: string;
  patientId: string;
  dob: string;
  verificationPin: string;
}

export interface VerifyPatientOutput {
  verified: boolean;
  token?: VerificationSession;
  errorCode?: string;
}

export interface TokenValidationResult {
  valid: boolean;
  errorCode?:
    | 'UNAUTHORIZED_NO_VALID_TOKEN'
    | 'TOKEN_EXPIRED'
    | 'SESSION_MISMATCH'
    | 'PATIENT_MISMATCH';
  session?: VerificationSession;
}

export class VerificationService {
  private readonly db: SchedulingDatabase;
  private readonly clock: ControllableClock;
  private tokenCounter = 0;
  private readonly tokenTtlMs: number;

  constructor(
    db: SchedulingDatabase,
    clock: ControllableClock,
    tokenTtlMs: number = 15 * 60 * 1000 // 15 minutes default
  ) {
    this.db = db;
    this.clock = clock;
    this.tokenTtlMs = tokenTtlMs;
  }

  public verifyPatient(input: VerifyPatientInput): VerifyPatientOutput {
    const row = this.db.sqlite
      .prepare(
        `SELECT patient_id, dob, verification_pin FROM patients WHERE patient_id = ?`
      )
      .get(input.patientId) as
      | { patient_id: string; dob: string; verification_pin: string }
      | undefined;

    if (
      !row ||
      row.dob !== input.dob.trim() ||
      row.verification_pin !== input.verificationPin.trim()
    ) {
      this.db.appendAuditEvent({
        conversationId: input.conversationId,
        patientId: input.patientId,
        eventType: 'VERIFICATION_REJECTED',
        outcome: 'REJECTED',
        details: {
          reason: !row ? 'PATIENT_NOT_FOUND' : 'INVALID_CREDENTIALS',
          attemptedPatientId: input.patientId
        }
      });
      return {
        verified: false,
        errorCode: !row ? 'PATIENT_NOT_FOUND' : 'INVALID_CREDENTIALS'
      };
    }

    // Revoke any existing active tokens for this conversation before issuing a fresh patient-scoped token
    this.db.sqlite
      .prepare(
        `UPDATE verification_sessions SET revoked = 1 WHERE conversation_id = ? AND revoked = 0`
      )
      .run(input.conversationId);

    this.tokenCounter += 1;
    const tokenId = `tok-${input.conversationId}-${this.tokenCounter}`;
    const issuedAtMs = this.clock.now();
    const expiresAtMs = issuedAtMs + this.tokenTtlMs;

    this.db.sqlite
      .prepare(
        `INSERT INTO verification_sessions (
          token_id, conversation_id, patient_id, issued_at_ms, expires_at_ms, revoked
        ) VALUES (?, ?, ?, ?, ?, 0)`
      )
      .run(tokenId, input.conversationId, input.patientId, issuedAtMs, expiresAtMs);

    const token: VerificationSession = {
      schemaVersion: SCHEMA_VERSION,
      tokenId,
      conversationId: input.conversationId,
      patientId: input.patientId,
      issuedAtMs,
      expiresAtMs,
      revoked: false
    };

    this.db.appendAuditEvent({
      conversationId: input.conversationId,
      patientId: input.patientId,
      eventType: 'VERIFICATION_SUCCEEDED',
      outcome: 'COMMITTED',
      details: {
        tokenId,
        expiresAtMs
      }
    });

    return {
      verified: true,
      token
    };
  }

  public revokeVerification(conversationId: string, reason: string = 'IDENTITY_SWITCH'): void {
    this.db.sqlite
      .prepare(`UPDATE verification_sessions SET revoked = 1 WHERE conversation_id = ?`)
      .run(conversationId);

    this.db.appendAuditEvent({
      conversationId,
      eventType: 'VERIFICATION_REVOKED',
      outcome: 'COMMITTED',
      details: { reason }
    });
  }

  public validateTokenForMutation(params: {
    verificationTokenId: string;
    conversationId: string;
    patientId: string;
  }): TokenValidationResult {
    if (!params.verificationTokenId) {
      return { valid: false, errorCode: 'UNAUTHORIZED_NO_VALID_TOKEN' };
    }

    const row = this.db.sqlite
      .prepare(`SELECT * FROM verification_sessions WHERE token_id = ?`)
      .get(params.verificationTokenId) as Record<string, unknown> | undefined;

    if (!row || Number(row.revoked) === 1) {
      return { valid: false, errorCode: 'UNAUTHORIZED_NO_VALID_TOKEN' };
    }

    const session: VerificationSession = {
      schemaVersion: SCHEMA_VERSION,
      tokenId: String(row.token_id),
      conversationId: String(row.conversation_id),
      patientId: String(row.patient_id),
      issuedAtMs: Number(row.issued_at_ms),
      expiresAtMs: Number(row.expires_at_ms),
      revoked: Number(row.revoked) === 1
    };

    if (session.conversationId !== params.conversationId) {
      return { valid: false, errorCode: 'SESSION_MISMATCH', session };
    }

    if (session.patientId !== params.patientId) {
      return { valid: false, errorCode: 'PATIENT_MISMATCH', session };
    }

    if (this.clock.now() > session.expiresAtMs) {
      return { valid: false, errorCode: 'TOKEN_EXPIRED', session };
    }

    return { valid: true, session };
  }
}
