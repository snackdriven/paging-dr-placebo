# Assumptions, Constraints, and Exclusions

## 1. Synthetic-Only Execution Constraints
- **No Real PHI or Clinical Data:** All patient names, dates of birth, PINs, provider schedules, and appointment records are 100% synthetic fixtures (`PAT-001` through `PAT-004`, `PRV-001` through `PRV-003`).
- **Local-Only Mutations:** All persistence uses local SQLite databases (in-memory or local `.runtime/` file). Zero external network calls are required to run the full test and evaluation suite.
- **Not Clinically Validated:** This software is an engineering evaluation laboratory for testing agent verification and observability properties. It is not HIPAA-compliant medical software.

## 2. Architectural Assumptions
- **Deterministic Clock:** Time-sensitive invariants (token expiration, relative date resolution such as *"next Tuesday"*, silence timeouts, and audit timestamps) use an injected `ControllableClock` initialized per scenario (default epoch: `2026-10-27T09:00:00.000Z`, Tuesday).
- **Provider-Neutral Agent Adapter:** The `SchedulingAgent` supports a deterministic rule-based / state-machine policy planner by default so that CI and regression suites execute deterministically without external LLM API keys, while also exposing a `ModelAdapter` interface for plugging in live LLMs or adversarial/faulty agent policies (used in negative evaluation scenarios `T10`, `T11`, `T12`, etc.).
- **SQLite Concurrency Model:** Node.js `node:sqlite` (`DatabaseSync`) executes synchronous atomic transactions (`BEGIN IMMEDIATE ... COMMIT / ROLLBACK`). Concurrent booking contention (`T07`) is tested both at the repository transaction barrier and across interleaved multi-session requests against shared database state.

## 3. Explicit Exclusions (Documented Scope Boundaries)
- **Level 2 Live Acoustic Audio Providers:** Level 1 deterministic `VoiceEventSimulator` (silence, barge-in, partial utterance, playback cancellation, ASR revision, turn timing) is fully implemented and verified. Level 2 live WebRTC/telephony acoustic audio and third-party ASR/TTS cloud calls are excluded from mandatory offline execution so the lab runs deterministically without external API keys; an explicit `AudioProviderAdapter` interface is provided for optional integration. We do not claim acoustic accuracy from Level 1 voice-event tests.
- **Graphical Web Dashboard:** Per execution efficiency constraints, reporting outputs machine-readable JSON (`reports/latest-evaluation.json`) and self-contained human-readable Markdown (`reports/latest-evaluation.md`) rather than a browser dashboard.
