interface TableRowMap {
  patients: Array<Record<string, unknown>>;
  providers: Array<Record<string, unknown>>;
  provider_slots: Array<Record<string, unknown>>;
  verification_sessions: Array<Record<string, unknown>>;
  appointments: Array<Record<string, unknown>>;
  escalations: Array<Record<string, unknown>>;
  idempotency_records: Array<Record<string, unknown>>;
  audit_events: Array<Record<string, unknown>>;
}

function cloneTables(t: TableRowMap): TableRowMap {
  return JSON.parse(JSON.stringify(t)) as TableRowMap;
}

export class DatabaseSync {
  private tables: TableRowMap = {
    patients: [],
    providers: [],
    provider_slots: [],
    verification_sessions: [],
    appointments: [],
    escalations: [],
    idempotency_records: [],
    audit_events: []
  };
  private txBackup: TableRowMap | null = null;
  private auditSeq = 0;

  constructor(_location: string = ':memory:') {}

  public close(): void {}

  public exec(sql: string): void {
    const trimmed = sql.trim();
    if (/^BEGIN/i.test(trimmed)) {
      this.txBackup = cloneTables(this.tables);
      return;
    }
    if (/^COMMIT/i.test(trimmed)) {
      this.txBackup = null;
      return;
    }
    if (/^ROLLBACK/i.test(trimmed)) {
      if (this.txBackup) {
        this.tables = this.txBackup;
        this.txBackup = null;
      }
      return;
    }

    for (const rawStmt of trimmed.split(';')) {
      const s = rawStmt.trim();
      if (!s) continue;
      if (/^DELETE FROM sqlite_sequence/i.test(s)) {
        this.auditSeq = 0;
      } else if (/^DELETE FROM (\w+)/i.test(s)) {
        const m = s.match(/^DELETE FROM (\w+)/i);
        const table = m?.[1] as keyof TableRowMap | undefined;
        if (table && this.tables[table]) {
          this.tables[table] = [];
        }
      }
    }
  }

  public prepare(sql: string) {
    const norm = sql.replace(/\s+/g, ' ').trim();
    const self = this;

    return {
      run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
        if (/^INSERT INTO patients/i.test(norm)) {
          self.tables.patients.push({
            patient_id: params[0],
            full_name: params[1],
            dob: params[2],
            verification_pin: params[3]
          });
          return { changes: 1, lastInsertRowid: self.tables.patients.length };
        }

        if (/^INSERT INTO providers/i.test(norm)) {
          self.tables.providers.push({
            provider_id: params[0],
            full_name: params[1],
            specialty: params[2]
          });
          return { changes: 1, lastInsertRowid: self.tables.providers.length };
        }

        if (/^INSERT INTO provider_slots/i.test(norm)) {
          self.tables.provider_slots.push({
            slot_id: params[0],
            provider_id: params[1],
            start_time_iso: params[2],
            end_time_iso: params[3],
            day_of_week: params[4]
          });
          return { changes: 1, lastInsertRowid: self.tables.provider_slots.length };
        }

        if (/^INSERT INTO appointments/i.test(norm)) {
          const isStaticBooked = /'BOOKED'/i.test(norm);
          const slotId = isStaticBooked ? params[3] : params[3];
          const status = isStaticBooked ? 'BOOKED' : String(params[4]);
          if (
            status === 'BOOKED' &&
            self.tables.appointments.some((a) => a.slot_id === slotId && a.status === 'BOOKED')
          ) {
            throw new Error(`UNIQUE constraint failed: appointments.slot_id (${String(slotId)})`);
          }

          if (isStaticBooked) {
            self.tables.appointments.push({
              appointment_id: params[0],
              patient_id: params[1],
              provider_id: params[2],
              slot_id: params[3],
              status: 'BOOKED',
              created_at_ms: params[4],
              updated_at_ms: params[5],
              operation_id: params[6],
              idempotency_key: params[7]
            });
          } else {
            self.tables.appointments.push({
              appointment_id: params[0],
              patient_id: params[1],
              provider_id: params[2],
              slot_id: params[3],
              status: params[4],
              created_at_ms: params[5],
              updated_at_ms: params[6],
              operation_id: params[7],
              idempotency_key: params[8]
            });
          }
          return { changes: 1, lastInsertRowid: self.tables.appointments.length };
        }

        if (/^UPDATE appointments SET status = 'CANCELED'/i.test(norm)) {
          const appt = self.tables.appointments.find((a) => a.appointment_id === params[3]);
          if (appt) {
            appt.status = 'CANCELED';
            appt.updated_at_ms = params[0];
            appt.operation_id = params[1];
            appt.idempotency_key = params[2];
          }
          return { changes: appt ? 1 : 0, lastInsertRowid: 0 };
        }

        if (/^UPDATE appointments SET provider_id = \?, slot_id = \?/i.test(norm)) {
          const appt = self.tables.appointments.find((a) => a.appointment_id === params[5]);
          if (appt) {
            appt.provider_id = params[0];
            appt.slot_id = params[1];
            appt.updated_at_ms = params[2];
            appt.operation_id = params[3];
            appt.idempotency_key = params[4];
          }
          return { changes: appt ? 1 : 0, lastInsertRowid: 0 };
        }

        if (/^UPDATE verification_sessions SET revoked = 1 WHERE conversation_id = \?/i.test(norm)) {
          let changes = 0;
          for (const s of self.tables.verification_sessions) {
            if (s.conversation_id === params[0]) {
              s.revoked = 1;
              changes += 1;
            }
          }
          return { changes, lastInsertRowid: 0 };
        }

        if (/^INSERT INTO verification_sessions/i.test(norm)) {
          self.tables.verification_sessions.push({
            token_id: params[0],
            conversation_id: params[1],
            patient_id: params[2],
            issued_at_ms: params[3],
            expires_at_ms: params[4],
            revoked: 0
          });
          return { changes: 1, lastInsertRowid: self.tables.verification_sessions.length };
        }

        if (/^INSERT INTO idempotency_records/i.test(norm)) {
          self.tables.idempotency_records.push({
            idempotency_key: params[0],
            operation_id: params[1],
            payload_hash: params[2],
            response_json: params[3],
            created_at_ms: params[4]
          });
          return { changes: 1, lastInsertRowid: self.tables.idempotency_records.length };
        }

        if (/^INSERT INTO escalations/i.test(norm)) {
          self.tables.escalations.push({
            escalation_id: params[0],
            conversation_id: params[1],
            patient_id: params[2],
            reason: params[3],
            created_at_ms: params[4]
          });
          return { changes: 1, lastInsertRowid: self.tables.escalations.length };
        }

        if (/^INSERT INTO audit_events/i.test(norm)) {
          self.auditSeq += 1;
          self.tables.audit_events.push({
            sequence_id: self.auditSeq,
            event_id: params[0],
            timestamp_ms: params[1],
            conversation_id: params[2],
            operation_id: params[3],
            idempotency_key: params[4],
            patient_id: params[5],
            event_type: params[6],
            outcome: params[7],
            details_json: params[8]
          });
          return { changes: 1, lastInsertRowid: self.auditSeq };
        }

        return { changes: 0, lastInsertRowid: 0 };
      },

      get(...params: unknown[]): unknown {
        if (/FROM patients WHERE patient_id = \?/i.test(norm)) {
          return self.tables.patients.find((p) => p.patient_id === params[0]);
        }
        if (/FROM verification_sessions WHERE token_id = \?/i.test(norm)) {
          return self.tables.verification_sessions.find((s) => s.token_id === params[0]);
        }
        if (/FROM idempotency_records WHERE idempotency_key = \? OR operation_id = \?/i.test(norm)) {
          return self.tables.idempotency_records.find(
            (r) => r.idempotency_key === params[0] || r.operation_id === params[1]
          );
        }
        if (/FROM idempotency_records WHERE idempotency_key = \?/i.test(norm)) {
          return self.tables.idempotency_records.find((r) => r.idempotency_key === params[0]);
        }
        if (/FROM provider_slots WHERE slot_id = \?/i.test(norm)) {
          return self.tables.provider_slots.find((s) => s.slot_id === params[0]);
        }
        if (/FROM appointments WHERE slot_id = \? AND status = 'BOOKED'/i.test(norm)) {
          return self.tables.appointments.find(
            (a) => a.slot_id === params[0] && a.status === 'BOOKED'
          );
        }
        if (/FROM appointments WHERE appointment_id = \?/i.test(norm)) {
          return self.tables.appointments.find((a) => a.appointment_id === params[0]);
        }
        return undefined;
      },

      all(..._params: unknown[]): unknown[] {
        if (/FROM audit_events/i.test(norm)) {
          return [...self.tables.audit_events].sort(
            (a, b) => Number(a.sequence_id) - Number(b.sequence_id)
          );
        }
        if (/FROM patients/i.test(norm)) {
          return [...self.tables.patients].sort((a, b) =>
            String(a.patient_id).localeCompare(String(b.patient_id))
          );
        }
        if (/FROM providers/i.test(norm)) {
          return [...self.tables.providers].sort((a, b) =>
            String(a.provider_id).localeCompare(String(b.provider_id))
          );
        }
        if (/FROM provider_slots s LEFT JOIN appointments/i.test(norm)) {
          return [...self.tables.provider_slots]
            .sort((a, b) => String(a.slot_id).localeCompare(String(b.slot_id)))
            .map((s) => {
              const booked = self.tables.appointments.some(
                (a) => a.slot_id === s.slot_id && a.status === 'BOOKED'
              );
              return { ...s, is_booked: booked ? 1 : 0 };
            });
        }
        if (/FROM provider_slots/i.test(norm)) {
          return [...self.tables.provider_slots].sort((a, b) =>
            String(a.slot_id).localeCompare(String(b.slot_id))
          );
        }
        if (/FROM appointments/i.test(norm)) {
          return [...self.tables.appointments].sort((a, b) =>
            String(a.appointment_id).localeCompare(String(b.appointment_id))
          );
        }
        if (/FROM verification_sessions/i.test(norm)) {
          return [...self.tables.verification_sessions].sort((a, b) =>
            String(a.token_id).localeCompare(String(b.token_id))
          );
        }
        if (/FROM escalations/i.test(norm)) {
          return [...self.tables.escalations].sort((a, b) =>
            String(a.escalation_id).localeCompare(String(b.escalation_id))
          );
        }
        return [];
      }
    };
  }
}
