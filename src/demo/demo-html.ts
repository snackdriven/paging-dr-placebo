export const DEMO_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Paging Dr. Placebo — Persuasive Scheduling Agent & Defect Lifecycle Demo</title>
  <style>
    :root {
      --bg: #0b0f19;
      --panel: #111827;
      --panel-alt: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --pass: #10b981;
      --fail: #f43f5e;
      --warn: #f59e0b;
      --purple: #a855f7;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    header {
      background: var(--panel);
      border-bottom: 1px solid var(--border);
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 14px;
    }
    .brand h1 {
      margin: 0;
      font-size: 1.25rem;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .brand p {
      margin: 4px 0 0 0;
      font-size: 0.85rem;
      color: var(--muted);
    }
    .header-actions {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }
    a.nav-link, button {
      background: var(--panel-alt);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 13px;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.15s ease;
    }
    a.nav-link:hover, button:hover:not(:disabled) {
      border-color: var(--accent);
    }
    button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    .btn-primary {
      background: rgba(56, 189, 248, 0.16);
      border-color: var(--accent);
      color: #e0f2fe;
    }
    .btn-danger {
      background: rgba(244, 63, 94, 0.16);
      border-color: var(--fail);
      color: #ffe4e6;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .badge-pass { background: rgba(16, 185, 129, 0.18); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); }
    .badge-fail { background: rgba(244, 63, 94, 0.2); color: #fb7185; border: 1px solid rgba(244, 63, 94, 0.45); }
    .badge-warn { background: rgba(245, 158, 11, 0.18); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); }
    .badge-info { background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35); }
    .badge-purple { background: rgba(168, 85, 247, 0.18); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.4); }

    /* Defect Lifecycle 5-Stage Bar */
    .lifecycle-bar {
      margin: 16px 24px 0 24px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px 18px;
    }
    .lifecycle-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 12px;
    }
    .lifecycle-steps {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 10px;
    }
    @media (max-width: 980px) {
      .lifecycle-steps { grid-template-columns: 1fr; }
    }
    .stage-btn {
      text-align: left;
      padding: 10px 12px;
      border-radius: 9px;
      background: var(--bg);
      border: 1px solid var(--border);
      cursor: pointer;
    }
    .stage-btn.active-stage {
      border-color: var(--accent);
      background: rgba(56, 189, 248, 0.11);
      box-shadow: inset 0 0 0 1px var(--accent);
    }
    .stage-num {
      font-size: 0.72rem;
      color: var(--accent);
      font-weight: 800;
      text-transform: uppercase;
    }
    .stage-title {
      font-size: 0.85rem;
      font-weight: 700;
      margin-top: 2px;
    }
    .stage-desc {
      font-size: 0.74rem;
      color: var(--muted);
      margin-top: 2px;
    }

    /* Main 3-Column Grid */
    .main-grid {
      display: grid;
      grid-template-columns: 330px 1fr 390px;
      gap: 16px;
      padding: 16px 24px 32px 24px;
      align-items: start;
    }
    @media (max-width: 1200px) {
      .main-grid { grid-template-columns: 1fr; }
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .panel h2 {
      margin: 0 0 12px 0;
      font-size: 0.96rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .scenario-card {
      width: 100%;
      text-align: left;
      padding: 11px 12px;
      margin-bottom: 8px;
      border-radius: 9px;
      background: var(--bg);
      border: 1px solid var(--border);
    }
    .scenario-card.active-card {
      border-color: var(--accent);
      background: rgba(56, 189, 248, 0.1);
    }
    .scenario-card-title {
      font-size: 0.85rem;
      font-weight: 700;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
    }
    .scenario-card-sub {
      font-size: 0.76rem;
      color: var(--muted);
      margin-top: 4px;
    }

    label {
      display: block;
      font-size: 0.76rem;
      font-weight: 600;
      color: var(--muted);
      margin: 10px 0 4px 0;
    }
    select, input[type="text"] {
      width: 100%;
      background: var(--bg);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 0.83rem;
    }

    /* 3 Truth Cards above Chat */
    .truth-triad {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin-bottom: 12px;
    }
    .truth-card {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 9px;
      padding: 10px 12px;
    }
    .truth-card h3 {
      margin: 0 0 4px 0;
      font-size: 0.74rem;
      color: var(--muted);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .truth-val {
      font-size: 0.88rem;
      font-weight: 700;
    }
    .truth-sub {
      font-size: 0.74rem;
      color: var(--muted);
      margin-top: 2px;
    }

    /* Stepper Bar & Chat */
    .stepper-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(56, 189, 248, 0.08);
      border: 1px solid rgba(56, 189, 248, 0.3);
      border-radius: 9px;
      padding: 8px 12px;
      margin-bottom: 10px;
    }
    .chat-box {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px;
      min-height: 230px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 12px;
    }
    .turn {
      max-width: 88%;
      padding: 10px 13px;
      border-radius: 10px;
      font-size: 0.85rem;
    }
    .turn-caller {
      align-self: flex-end;
      background: rgba(56, 189, 248, 0.14);
      border: 1px solid rgba(56, 189, 248, 0.35);
    }
    .turn-agent {
      align-self: flex-start;
      background: var(--panel-alt);
      border: 1px solid var(--border);
    }
    .turn-latest {
      box-shadow: 0 0 0 2px var(--accent);
    }
    .turn-meta {
      font-size: 0.72rem;
      color: var(--muted);
      margin-top: 4px;
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .code-diff-box {
      background: #070a12;
      border: 1px solid var(--border);
      border-radius: 9px;
      padding: 12px;
      font-family: 'JetBrains Mono', Consolas, monospace;
      font-size: 0.77rem;
      overflow-x: auto;
      margin-bottom: 12px;
    }
    .diff-del { color: #fb7185; background: rgba(244, 63, 94, 0.12); display: block; padding: 2px 6px; border-radius: 4px; }
    .diff-add { color: #34d399; background: rgba(16, 185, 129, 0.12); display: block; padding: 2px 6px; border-radius: 4px; margin-top: 2px; }

    /* Flag Cards */
    .flag-card {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
      margin-bottom: 8px;
    }
    .flag-card.flagged {
      border-color: var(--fail);
      background: rgba(244, 63, 94, 0.13);
      box-shadow: inset 4px 0 0 var(--fail);
    }
    .flag-card.clean {
      border-color: rgba(16, 185, 129, 0.35);
    }
    .flag-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.82rem;
      font-weight: 700;
    }
    .flag-desc {
      font-size: 0.76rem;
      color: var(--muted);
      margin-top: 4px;
    }

    .log-entry {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 7px;
      padding: 8px 10px;
      font-size: 0.78rem;
      margin-bottom: 6px;
    }
    details.clean-accordion {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 9px 12px;
      margin-top: 10px;
    }
    details.clean-accordion summary {
      cursor: pointer;
      font-size: 0.81rem;
      font-weight: 700;
      color: var(--text);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <h1>
        <span>🩺 Paging Dr. Placebo</span>
        <span class="badge badge-info">Persuasive Demo &amp; Defect Lifecycle</span>
      </h1>
      <p>
        Small synthetic scheduling agent + independent observer flagging <strong>false confirmations</strong>, <strong>duplicate actions</strong>, and <strong>incorrect disposition states</strong>.
      </p>
    </div>
    <div class="header-actions">
      <a class="nav-link" href="./index.html">Open Full 21-Scenario Lab →</a>
    </div>
  </header>

  <!-- 5-Stage Defect Lifecycle Interactive Bar -->
  <section class="lifecycle-bar" aria-label="Defect Lifecycle Walkthrough">
    <div class="lifecycle-top">
      <div>
        <strong style="font-size: 0.92rem;">Interactive Defect Lifecycle Walkthrough (DEFECT-042)</strong>
        <span style="color: var(--muted); font-size: 0.8rem; margin-left: 8px;">
          Click each stage below to walk from failure discovery to verified fix.
        </span>
      </div>
      <div style="display: flex; gap: 8px;">
        <button onclick="stepLifecycle(-1)" id="prevStageBtn">← Previous Stage</button>
        <button class="btn-primary" onclick="stepLifecycle(1)" id="nextStageBtn">Next Lifecycle Stage →</button>
      </div>
    </div>

    <div class="lifecycle-steps" id="lifecycleStepsGrid">
      <button class="stage-btn" data-stage="1" onclick="selectLifecycleStage(1)">
        <div class="stage-num">Stage 1 · Discovery</div>
        <div class="stage-title">Failure Discovered</div>
        <div class="stage-desc">Server crashes, but the buggy AI lies &amp; says "You're booked!"</div>
      </button>
      <button class="stage-btn" data-stage="2" onclick="selectLifecycleStage(2)">
        <div class="stage-num">Stage 2 · Root Cause</div>
        <div class="stage-title">Root Cause Identified</div>
        <div class="stage-desc">See the exact 3 mistakes in the AI's booking code</div>
      </button>
      <button class="stage-btn" data-stage="3" onclick="selectLifecycleStage(3)">
        <div class="stage-num">Stage 3 · Code Fix</div>
        <div class="stage-title">Fix Applied</div>
        <div class="stage-desc">Check if the save succeeded before telling the patient "Booked"</div>
      </button>
      <button class="stage-btn" data-stage="4" onclick="selectLifecycleStage(4)">
        <div class="stage-num">Stage 4 · Regression</div>
        <div class="stage-title">Regression Added</div>
        <div class="stage-desc">Run 5 automated safety tests so the bug can never come back</div>
      </button>
      <button class="stage-btn" data-stage="5" onclick="selectLifecycleStage(5)">
        <div class="stage-num">Stage 5 · Verified</div>
        <div class="stage-title">Outcome Verified</div>
        <div class="stage-desc">Safe retry with zero double-bookings and 0 observer flags</div>
      </button>
    </div>
  </section>

  <div class="main-grid">
    <!-- Left Column: 4 Core Scenarios + Sandbox Controls -->
    <div>
      <div class="panel">
        <h2>
          <span>1. Pick a Demo Scenario</span>
          <span class="badge badge-info">4 Flows</span>
        </h2>

        <button class="scenario-card active-card" id="scen-straightforward" onclick="loadPresetScenario('straightforward')">
          <div class="scenario-card-title">
            <span>Straightforward Booking</span>
            <span class="badge badge-pass">Pass</span>
          </div>
          <div class="scenario-card-sub">
            Fry verifies his PIN, confirms Thursday 10:00 AM, and gets booked cleanly.
          </div>
        </button>

        <button class="scenario-card" id="scen-variations" onclick="loadPresetScenario('variations')">
          <div class="scenario-card-title">
            <span>Conversational Variations</span>
            <span class="badge badge-pass">Pass</span>
          </div>
          <div class="scenario-card-sub">
            Caller asks what's open, uses casual phrasing, then switches from Tuesday 2pm to Wednesday 11am.
          </div>
        </button>

        <button class="scenario-card" id="scen-safe500" onclick="loadPresetScenario('safe500')">
          <div class="scenario-card-title">
            <span>Fails Safely When Server Crashes</span>
            <span class="badge badge-pass">Safe Fail</span>
          </div>
          <div class="scenario-card-sub">
            The calendar server crashes; the AI apologizes honestly and pages a human receptionist.
          </div>
        </button>

        <button class="scenario-card" id="scen-defect042" onclick="loadPresetScenario('defect042')">
          <div class="scenario-card-title">
            <span>Unpatched Bug (DEFECT-042)</span>
            <span class="badge badge-fail">3 Flags</span>
          </div>
          <div class="scenario-card-sub">
            Server crashes, but the buggy AI retries blindly, lies "You're all set!", and marks the call Booked.
          </div>
        </button>

        <button class="scenario-card" id="scen-idempotent" onclick="loadPresetScenario('idempotent')">
          <div class="scenario-card-title">
            <span>Patched Fix on Network Timeout</span>
            <span class="badge badge-pass">Fixed</span>
          </div>
          <div class="scenario-card-sub">
            Connection drops right after saving; the fixed AI retries with a safety receipt so it never double-books.
          </div>
        </button>
      </div>

      <div class="panel">
        <h2>
          <span>2. Live Sandbox Controls</span>
          <span class="badge badge-purple" id="sandboxModePill">Patched Safe</span>
        </h2>

        <label for="agentVersionSelect">Agent Code Version</label>
        <select id="agentVersionSelect" onchange="onCustomConfigChange()">
          <option value="PATCHED">Patched Agent (Safe + Idempotent)</option>
          <option value="DEFECT_042">Unpatched Bug (DEFECT-042 Active)</option>
        </select>

        <label for="apiFaultSelect">Appointment API Behavior</label>
        <select id="apiFaultSelect" onchange="onCustomConfigChange()">
          <option value="NONE">Working Normally (HTTP 200)</option>
          <option value="API_HTTP_500">Hard Outage (HTTP 500 Internal Error)</option>
          <option value="API_TIMEOUT_FIRST_CALL">Timeout After DB Write on 1st Call</option>
          <option value="SLOT_TAKEN">Slot Conflict (Already Taken)</option>
        </select>
      </div>
    </div>

    <!-- Center Column: Truth Triad + Step-by-Step Transcript + Defect Lifecycle Inspector -->
    <div>
      <div class="panel">
        <h2>
          <span id="centerPanelTitle">Phone Call &amp; Authoritative Backend State</span>
          <span class="badge badge-info" id="turnCounterBadge">Turn 3 of 3</span>
        </h2>

        <!-- 3 Truth Cards -->
        <div class="truth-triad">
          <div class="truth-card">
            <h3>
              <span>1. Agent Claim</span>
              <span class="badge badge-info" id="cardClaimBadge">Waiting</span>
            </h3>
            <div class="truth-val" id="cardClaimVal">No claim yet</div>
            <div class="truth-sub" id="cardClaimSub">What the caller heard</div>
          </div>

          <div class="truth-card">
            <h3>
              <span>2. Call Disposition</span>
              <span class="badge badge-info" id="cardDispBadge">State</span>
            </h3>
            <div class="truth-val" id="cardDispVal">IN_PROGRESS</div>
            <div class="truth-sub" id="cardDispSub">Recorded session disposition</div>
          </div>

          <div class="truth-card">
            <h3>
              <span>3. Appointment API DB</span>
              <span class="badge badge-info" id="cardDbBadge">Truth</span>
            </h3>
            <div class="truth-val" id="cardDbVal">0 Booked</div>
            <div class="truth-sub" id="cardDbSub">Authoritative backend state</div>
          </div>
        </div>

        <!-- Root Cause Code Diff Box (Shown on Lifecycle Stage 2 & 3) -->
        <div id="codeDiffPanel" class="code-diff-box" style="display: none;">
          <div style="font-weight: 700; color: var(--accent); margin-bottom: 4px;" id="codeDiffTitle">
            Why the Bug Happened &amp; How We Fixed It
          </div>
          <div style="font-family: 'Inter', sans-serif; font-size: 0.79rem; color: var(--muted); margin-bottom: 8px;">
            <strong>In Plain English:</strong> The buggy AI didn't attach a safety receipt number when retrying, and it told the patient <em>"You're all set!"</em> without checking if the calendar server actually saved the appointment.
          </div>
          <span class="diff-del">- // BEFORE (Buggy): Retries without a safety receipt key, then says "Booked!" even when the server crashed</span>
          <span class="diff-del">- let res = this.api.bookAppointment({ patientId, slotId, idempotencyKey: null });</span>
          <span class="diff-del">- if (!res.ok) res = this.api.bookAppointment({ patientId, slotId, idempotencyKey: null });</span>
          <span class="diff-del">- this.disposition = 'BOOKED'; return this.appendAgentTurn('You are all set! ...', true, slotId);</span>
          <span class="diff-add">+ // AFTER (Fixed): Attaches a safety receipt key, checks res.ok first, and pages a human if the server is down</span>
          <span class="diff-add">+ const idempotencyKey = \`idem-\${this.conversationId}-\${patientId}-\${slotId}-v\${this.proposalVersion}\`;</span>
          <span class="diff-add">+ let res = this.api.bookAppointment({ patientId, slotId, idempotencyKey });</span>
          <span class="diff-add">+ if (res.status === 'TIMEOUT_ERROR') res = this.api.bookAppointment({ patientId, slotId, idempotencyKey });</span>
          <span class="diff-add">+ if (!res.ok) { this.api.recordEscalation(...); this.disposition = 'FAILED_SAFE_ESCALATED'; ... }</span>
        </div>

        <!-- Regression Test Runner Output (Shown on Lifecycle Stage 4) -->
        <div id="regressionPanel" style="display: none; margin-bottom: 12px;"></div>

        <!-- Turn-by-Turn Stepper -->
        <div class="stepper-bar">
          <div style="font-size: 0.81rem; font-weight: 700;" id="stepperStatusText">
            Walk through the conversation one exchange at a time:
          </div>
          <div style="display: flex; gap: 6px;">
            <button id="prevTurnBtn" onclick="stepTurn(-2)">← Prev Exchange</button>
            <button class="btn-primary" id="nextTurnBtn" onclick="stepTurn(2)">Next Exchange →</button>
            <button id="allTurnsBtn" onclick="showAllTurns()">Show All</button>
          </div>
        </div>

        <div class="chat-box" id="chatBox"></div>

        <!-- Custom Utterance Input -->
        <div style="display: flex; gap: 8px;">
          <input
            type="text"
            id="customUtteranceInput"
            placeholder="Or type a custom caller turn (e.g. 'Wait, can we do Wednesday at 11am instead?')"
            onkeydown="if(event.key==='Enter') sendCustomUtterance()"
          />
          <button class="btn-primary" onclick="sendCustomUtterance()">Send Turn</button>
        </div>
      </div>

      <!-- Backend API Call Log & Committed Records -->
      <div class="panel">
        <h2>
          <span>Appointment API Call Log &amp; Idempotency Receipts</span>
          <span class="badge badge-info" id="apiLogCountBadge">0 API Calls</span>
        </h2>
        <div id="apiCallLogList"></div>
      </div>
    </div>

    <!-- Right Column: Independent Observer (3 Deterministic Flags + AI Judgment + Recording Review) -->
    <div>
      <div class="panel">
        <h2>
          <span>Independent Observer Verdict</span>
          <span class="badge badge-pass" id="observerVerdictBadge">PASS</span>
        </h2>

        <!-- Tier 1: Deterministic Checks (The 3 Required Flags) -->
        <div style="font-size: 0.77rem; font-weight: 800; color: var(--accent); text-transform: uppercase; margin-bottom: 6px;">
          Tier 1 · Deterministic Checks (Automated CI Gate)
        </div>
        <div id="deterministicFlagsContainer"></div>

        <!-- Tier 2: AI Judgment Rubrics -->
        <div style="font-size: 0.77rem; font-weight: 800; color: var(--purple); text-transform: uppercase; margin: 14px 0 6px 0;">
          Tier 2 · AI Judgment Rubrics (Semantic / Tone)
        </div>
        <div id="aiJudgmentContainer"></div>

        <!-- Tier 3: Reviewing Recordings -->
        <details class="clean-accordion" open>
          <summary>
            <span>Tier 3 · Requires Reviewing Recordings</span>
            <span class="badge badge-warn">3 Acoustic Checks</span>
          </summary>
          <div style="margin-top: 8px; font-size: 0.76rem; color: var(--muted);" id="recordingChecklistContainer"></div>
        </details>
      </div>
    </div>
  </div>

  <script>
    const PRESET_SCENARIOS = {
      straightforward: {
        title: 'Straightforward Booking',
        faultMode: 'NONE',
        simulateDefect042: false,
        utterances: [
          'Hi, I am PAT-001 and I want to book Thursday at 10:00 AM.',
          'My DOB is 1985-04-12 and my PIN is 4821.',
          'Yes, confirm.'
        ]
      },
      variations: {
        title: 'Conversational Variations (Inquiry + Slot Switch)',
        faultMode: 'NONE',
        simulateDefect042: false,
        utterances: [
          'What openings does Dr. Zoidberg have this week?',
          'Hey there, this is Fry (1985-04-12, PIN 4821). Can we do Tuesday afternoon?',
          'Wait, scratch Tuesday — can we do Wednesday at 11am instead?',
          'Yep, lock that in please!'
        ]
      },
      safe500: {
        title: 'Fails Safely When Appointment API Errors (HTTP 500)',
        faultMode: 'API_HTTP_500',
        simulateDefect042: false,
        utterances: [
          'I am PAT-001, DOB 1985-04-12, PIN 4821. Book Thursday at 10am.',
          'Sounds good, go ahead.'
        ]
      },
      defect042: {
        title: 'Unpatched DEFECT-042 (False Confirmation + Duplicate Action + Wrong Disposition)',
        faultMode: 'API_HTTP_500',
        simulateDefect042: true,
        utterances: [
          'I am PAT-001, DOB 1985-04-12, PIN 4821. Book Thursday at 10am.',
          'Yes, confirm.'
        ]
      },
      idempotent: {
        title: 'Patched DEFECT-042 Fix Under API Timeout (Idempotent Retry)',
        faultMode: 'API_TIMEOUT_FIRST_CALL',
        simulateDefect042: false,
        utterances: [
          'I am PAT-001, DOB 1985-04-12, PIN 4821. Book Thursday at 10am.',
          'Yes, confirm.'
        ]
      }
    };

    let activePresetKey = 'straightforward';
    let activeLifecycleStage = 0; // 0 = free exploration, 1..5 = defect lifecycle stages
    let currentSession = null;
    let fullState = null;
    let visibleTurnCount = 2;

    const HUMAN_PATIENTS = {
      'PAT-001': 'Philip J. Fry',
      'PAT-002': 'Turanga Leela',
      'PAT-003': 'Bender'
    };

    const HUMAN_SLOTS = {
      'SLOT-THU-10': 'Thursday at 10:00 AM with Dr. Zoidberg',
      'SLOT-TUE-14': 'Tuesday at 2:00 PM with Dr. Zoidberg',
      'SLOT-TUE-09': 'Tuesday at 9:00 AM with Dr. Zoidberg',
      'SLOT-WED-11': 'Wednesday at 11:00 AM with Prof. Wernstrom'
    };

    const HUMAN_DISPOSITIONS = {
      'IN_PROGRESS': 'Talking with Caller',
      'INQUIRY_ONLY': 'Browsing Open Times',
      'AWAITING_CONFIRMATION': 'Waiting for Caller to Say "Yes"',
      'BOOKED': 'Marked Call as "Booked"',
      'REJECTED_CONFLICT': 'Time Slot Already Taken',
      'FAILED_SAFE_ESCALATED': 'Safely Transferred to Human'
    };

    const HUMAN_API_ACTIONS = {
      'BOOK_APPOINTMENT': 'Try to Save Appointment',
      'RECORD_ESCALATION': 'Page Front-Desk Human'
    };

    const HUMAN_API_OUTCOMES = {
      'COMMITTED': 'Saved to Calendar',
      'IDEMPOTENT_REPLAY': 'Safe Retry (No Duplicate Created)',
      'HTTP_500_ERROR': 'Server Crashed (Error 500)',
      'TIMEOUT_ERROR': 'Connection Dropped After Saving',
      'CONFLICT': 'Blocked (Time Already Taken)'
    };

    const HUMAN_RUBRICS = {
      'EMPATHY_ON_API_ERROR': 'Polite Apology & Recovery When Server Fails',
      'CLARITY_OF_NEXT_STEPS': 'Clear Next Step or Confirmation Number'
    };

    function humanizeDemoText(raw) {
      if (!raw) return '';
      let text = String(raw);
      Object.entries(HUMAN_SLOTS).forEach(([id, label]) => {
        text = text.split(id).join(label);
      });
      Object.entries(HUMAN_PATIENTS).forEach(([id, name]) => {
        text = text.split(id).join(name);
      });
      text = text
        .replace(/\\(HTTP_500_ERROR\\)/g, '(calendar server offline)')
        .replace(/BOOK_APPOINTMENT/g, 'booking request')
        .replace(/idempotencyKey/g, 'safety receipt key');
      return text;
    }

    function loadPresetScenario(key, preserveLifecycleStage = false) {
      activePresetKey = key;
      if (!preserveLifecycleStage) {
        activeLifecycleStage = 0;
        updateLifecycleButtons();
        document.getElementById('codeDiffPanel').style.display = 'none';
        document.getElementById('regressionPanel').style.display = 'none';
      }

      document.querySelectorAll('.scenario-card').forEach(btn => {
        btn.classList.toggle('active-card', btn.id === 'scen-' + key);
      });

      const preset = PRESET_SCENARIOS[key];
      document.getElementById('agentVersionSelect').value = preset.simulateDefect042 ? 'DEFECT_042' : 'PATCHED';
      document.getElementById('apiFaultSelect').value = preset.faultMode;

      currentSession = window.DemoLab.createSession({
        conversationId: 'conv-' + key,
        faultMode: preset.faultMode,
        simulateDefect042: preset.simulateDefect042
      });

      for (const u of preset.utterances) {
        fullState = currentSession.sendTurn(u);
      }

      // Show all turns immediately when inspecting a lifecycle stage, or start at 1st exchange for normal preset
      visibleTurnCount = preserveLifecycleStage ? fullState.turns.length : Math.min(2, fullState.turns.length);
      renderUI();
    }

    function onCustomConfigChange() {
      const simulateDefect042 = document.getElementById('agentVersionSelect').value === 'DEFECT_042';
      const faultMode = document.getElementById('apiFaultSelect').value;

      currentSession = window.DemoLab.createSession({
        conversationId: 'conv-custom',
        faultMode,
        simulateDefect042
      });

      // Replay the current preset's utterances against the newly selected agent version + fault mode!
      const preset = PRESET_SCENARIOS[activePresetKey] || PRESET_SCENARIOS.straightforward;
      for (const u of preset.utterances) {
        fullState = currentSession.sendTurn(u);
      }
      visibleTurnCount = fullState.turns.length;
      renderUI();
    }

    function sendCustomUtterance() {
      const input = document.getElementById('customUtteranceInput');
      const text = input.value.trim();
      if (!text || !currentSession) return;
      fullState = currentSession.sendTurn(text);
      visibleTurnCount = fullState.turns.length;
      input.value = '';
      renderUI();
    }

    function stepTurn(delta) {
      if (!fullState) return;
      const total = fullState.turns.length;
      visibleTurnCount = Math.max(2, Math.min(total, visibleTurnCount + delta));
      renderUI();
    }

    function showAllTurns() {
      if (!fullState) return;
      visibleTurnCount = fullState.turns.length;
      renderUI();
    }

    function selectLifecycleStage(stageNum) {
      activeLifecycleStage = stageNum;
      updateLifecycleButtons();

      const diffPanel = document.getElementById('codeDiffPanel');
      const regPanel = document.getElementById('regressionPanel');
      diffPanel.style.display = 'none';
      regPanel.style.display = 'none';

      if (stageNum === 1) {
        // Stage 1: Failure Discovered -> Run unpatched DEFECT-042 on API 500
        loadPresetScenario('defect042', true);
      } else if (stageNum === 2) {
        // Stage 2: Root Cause Identified -> Show unpatched DEFECT-042 + highlight buggy code lines
        loadPresetScenario('defect042', true);
        diffPanel.style.display = 'block';
        document.getElementById('codeDiffTitle').textContent =
          'Stage 2 · Root Cause Identified in DemoSchedulingAgent.handleCallerUtterance()';
      } else if (stageNum === 3) {
        // Stage 3: Fix Applied -> Switch to patched safe500 + show green fix diff
        loadPresetScenario('safe500', true);
        diffPanel.style.display = 'block';
        document.getElementById('codeDiffTitle').textContent =
          'Stage 3 · Fix Applied: Idempotency Key + Response-Gated Confirmation + Safe Escalation';
      } else if (stageNum === 4) {
        // Stage 4: Regression Added -> Run all 5 automated regression checks in browser
        loadPresetScenario('idempotent', true);
        const results = window.DemoLab.runRegressionSuite();
        regPanel.style.display = 'block';
        regPanel.innerHTML = \`
          <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.4); border-radius: 9px; padding: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <strong style="font-size: 0.85rem;">Stage 4 · Regression Suite (tests/demo/defect-lifecycle.test.ts)</strong>
              <span class="badge badge-pass">\${results.filter(r => r.passed).length}/\${results.length} Passing</span>
            </div>
            \${results.map(r => \`
              <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem; padding: 5px 0; border-top: 1px solid rgba(255,255,255,0.06);">
                <div><strong>\${r.id}:</strong> \${r.title} <span style="color: var(--muted);">— \${r.summary}</span></div>
                <span class="badge \${r.passed ? 'badge-pass' : 'badge-fail'}">\${r.passed ? 'PASS' : 'FAIL'}</span>
              </div>
            \`).join('')}
          </div>
        \`;
      } else if (stageNum === 5) {
        // Stage 5: Outcome Verified -> Show idempotent retry under timeout succeeding with 1 booking & 0 flags
        loadPresetScenario('idempotent', true);
      }
    }

    function stepLifecycle(delta) {
      const next = activeLifecycleStage === 0 ? 1 : Math.max(1, Math.min(5, activeLifecycleStage + delta));
      selectLifecycleStage(next);
    }

    function updateLifecycleButtons() {
      document.querySelectorAll('#lifecycleStepsGrid .stage-btn').forEach(btn => {
        const s = Number(btn.getAttribute('data-stage'));
        btn.classList.toggle('active-stage', s === activeLifecycleStage);
      });
    }

    function renderUI() {
      if (!fullState) return;
      const totalTurns = fullState.turns.length;
      const isFinalStep = visibleTurnCount >= totalTurns;
      const visibleTurns = fullState.turns.slice(0, visibleTurnCount);
      const lastAgentTurn = [...visibleTurns].reverse().find(t => t.speaker === 'AGENT');

      // Update Sandbox Pill
      const modePill = document.getElementById('sandboxModePill');
      modePill.className = 'badge ' + (fullState.simulateDefect042 ? 'badge-fail' : 'badge-pass');
      modePill.textContent = fullState.simulateDefect042 ? 'Unpatched Bug (DEFECT-042)' : 'Patched Safe Agent';

      // Stepper Controls
      document.getElementById('turnCounterBadge').textContent = \`Turn \${visibleTurnCount} of \${totalTurns}\`;
      document.getElementById('prevTurnBtn').disabled = visibleTurnCount <= 2;
      document.getElementById('nextTurnBtn').disabled = isFinalStep;
      document.getElementById('allTurnsBtn').disabled = isFinalStep;

      // Render Chat Bubbles
      const chatBox = document.getElementById('chatBox');
      chatBox.innerHTML = visibleTurns.map((t, idx) => {
        const isCaller = t.speaker === 'CALLER';
        const isLatest = idx === visibleTurns.length - 1;
        const friendlyDisp = HUMAN_DISPOSITIONS[t.dispositionAfterTurn] || t.dispositionAfterTurn;
        return \`
          <div class="turn \${isCaller ? 'turn-caller' : 'turn-agent'} \${isLatest ? 'turn-latest' : ''}">
            <div><strong>\${isCaller ? 'Caller' : 'Clinic AI'}:</strong> \${humanizeDemoText(t.text)}</div>
            <div class="turn-meta">
              <span>Turn #\${t.turnIndex}</span>
              <span>Call Status: <strong>\${friendlyDisp}</strong></span>
              \${t.claimedBooked ? '<span class="badge badge-info">AI Said "Booked!"</span>' : ''}
            </div>
          </div>
        \`;
      }).join('');

      // Render 3 Truth Cards
      const ev = fullState.evaluation;
      const hasFalseClaim = isFinalStep && ev && ev.deterministicFlags.some(f => f.code === 'FALSE_CONFIRMATION');
      const hasWrongDisp = isFinalStep && ev && ev.deterministicFlags.some(f => f.code === 'INCORRECT_DISPOSITION_STATE');

      const claimBadge = document.getElementById('cardClaimBadge');
      const claimVal = document.getElementById('cardClaimVal');
      const claimSub = document.getElementById('cardClaimSub');
      if (lastAgentTurn && lastAgentTurn.claimedBooked) {
        claimBadge.className = 'badge ' + (hasFalseClaim ? 'badge-fail' : 'badge-pass');
        claimBadge.textContent = hasFalseClaim ? 'AI Lied!' : 'Told the Truth';
        claimVal.textContent = '"You are all booked!"';
        claimSub.textContent = HUMAN_SLOTS[lastAgentTurn.claimedSlotId] || lastAgentTurn.claimedSlotId || '';
      } else {
        claimBadge.className = 'badge badge-info';
        claimBadge.textContent = 'Honest';
        claimVal.textContent = isFinalStep && fullState.finalDisposition === 'FAILED_SAFE_ESCALATED'
          ? '"Server error — paging a human"'
          : 'Waiting to confirm';
        claimSub.textContent = 'Did not falsely promise a booking';
      }

      const dispBadge = document.getElementById('cardDispBadge');
      const dispVal = document.getElementById('cardDispVal');
      const dispSub = document.getElementById('cardDispSub');
      const currentDisp = lastAgentTurn ? lastAgentTurn.dispositionAfterTurn : 'IN_PROGRESS';
      dispBadge.className = 'badge ' + (hasWrongDisp ? 'badge-fail' : 'badge-pass');
      dispBadge.textContent = hasWrongDisp ? 'Wrong Status!' : 'Accurate';
      dispVal.textContent = HUMAN_DISPOSITIONS[currentDisp] || currentDisp;
      dispSub.textContent = hasWrongDisp
        ? 'Does NOT match the real calendar!'
        : 'Matches what actually happened';

      const dbBadge = document.getElementById('cardDbBadge');
      const dbVal = document.getElementById('cardDbVal');
      const dbSub = document.getElementById('cardDbSub');
      const appts = isFinalStep ? fullState.apiSnapshot.appointments : [];
      const escs = isFinalStep ? fullState.apiSnapshot.escalations : [];
      dbBadge.className = 'badge ' + (appts.length > 0 ? 'badge-pass' : (escs.length > 0 ? 'badge-warn' : 'badge-info'));
      dbBadge.textContent = appts.length > 0 ? 'Saved' : (escs.length > 0 ? 'Human Paged' : 'Unchanged');
      dbVal.textContent = \`\${appts.length} Saved Booking · \${escs.length} Human Transfer\`;
      dbSub.textContent = appts.length > 0
        ? \`Saved \${HUMAN_SLOTS[appts[0].slotId] || appts[0].slotId}\`
        : (escs.length > 0 ? \`Front-desk ticket \${escs[0].ticketId} opened\` : 'Nothing saved on calendar');

      // Render API Call Log
      const callLog = isFinalStep ? fullState.apiSnapshot.callLog : [];
      document.getElementById('apiLogCountBadge').textContent = \`\${callLog.length} Server Actions\`;
      const apiLogContainer = document.getElementById('apiCallLogList');
      if (callLog.length === 0) {
        apiLogContainer.innerHTML = '<div style="color: var(--muted); font-size: 0.8rem;">No calendar changes attempted on this step yet.</div>';
      } else {
        apiLogContainer.innerHTML = callLog.map(c => {
          const isErr = c.outcome === 'HTTP_500_ERROR' || c.outcome === 'TIMEOUT_ERROR' || c.outcome === 'CONFLICT';
          const friendlyAction = HUMAN_API_ACTIONS[c.action] || c.action;
          const friendlyOutcome = HUMAN_API_OUTCOMES[c.outcome] || c.outcome;
          const friendlySlot = c.slotId ? (HUMAN_SLOTS[c.slotId] || c.slotId) : 'Front Desk';
          const friendlyPatient = c.patientId ? (HUMAN_PATIENTS[c.patientId] || c.patientId) : '';
          const receiptLabel = c.idempotencyKey
            ? '<span style="color: #34d399;">Included (Prevents double-booking)</span>'
            : '<span style="color: #fb7185; font-weight: 700;">Missing! (Causes duplicate actions)</span>';
          return \`
            <div class="log-entry">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span><strong>Step #\${c.callIndex}:</strong> \${friendlyAction} (\${friendlySlot})</span>
                <span class="badge \${isErr ? 'badge-fail' : 'badge-pass'}">\${friendlyOutcome}</span>
              </div>
              <div style="color: var(--muted); font-size: 0.74rem; margin-top: 3px;">
                Caller: \${friendlyPatient} · Safety Receipt Key: \${receiptLabel}
              </div>
            </div>
          \`;
        }).join('');
      }

      // Render Right Column: Independent Observer
      const vBadge = document.getElementById('observerVerdictBadge');
      const detContainer = document.getElementById('deterministicFlagsContainer');
      const aiContainer = document.getElementById('aiJudgmentContainer');
      const recContainer = document.getElementById('recordingChecklistContainer');

      const ALL_THREE_CHECKS = [
        {
          code: 'FALSE_CONFIRMATION',
          title: '1. False Confirmation Check',
          cleanDesc: 'The AI never claimed an appointment was booked without it actually being saved.'
        },
        {
          code: 'DUPLICATE_ACTION',
          title: '2. Duplicate Action Check',
          cleanDesc: 'All retries used a shared safety receipt key so the patient was never double-booked.'
        },
        {
          code: 'INCORRECT_DISPOSITION_STATE',
          title: '3. Call Status (Disposition) Check',
          cleanDesc: 'The final call label matches what actually happened in the clinic database.'
        }
      ];

      if (!isFinalStep) {
        vBadge.className = 'badge badge-info';
        vBadge.textContent = 'Stepping...';
      } else if (ev.verdict === 'PASS') {
        vBadge.className = 'badge badge-pass';
        vBadge.textContent = 'All Good (0 Flags)';
      } else {
        vBadge.className = 'badge badge-fail';
        vBadge.textContent = \`Caught Bug (\${ev.deterministicFlags.length} Flags)\`;
      }

      detContainer.innerHTML = ALL_THREE_CHECKS.map(chk => {
        const raised = isFinalStep && ev ? ev.deterministicFlags.find(f => f.code === chk.code) : null;
        return \`
          <div class="flag-card \${raised ? 'flagged' : 'clean'}">
            <div class="flag-header">
              <span>\${chk.title}</span>
              <span class="badge \${raised ? 'badge-fail' : 'badge-pass'}">\${raised ? 'CAUGHT BUG' : 'Clean'}</span>
            </div>
            <div class="flag-desc">\${raised ? humanizeDemoText(raised.explanation) : chk.cleanDesc}</div>
          </div>
        \`;
      }).join('');

      if (ev) {
        aiContainer.innerHTML = ev.aiJudgmentScores.map(s => \`
          <div class="flag-card \${s.passed ? 'clean' : 'flagged'}">
            <div class="flag-header">
              <span>\${HUMAN_RUBRICS[s.criterion] || s.criterion}</span>
              <span class="badge \${s.passed ? 'badge-purple' : 'badge-fail'}">\${s.passed ? 'Passed' : 'Needs Work'}</span>
            </div>
            <div class="flag-desc">\${humanizeDemoText(s.rationale)}</div>
          </div>
        \`).join('');

        recContainer.innerHTML = ev.recordingReviewChecklist.map(item => \`
          <div style="padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">• \${item}</div>
        \`).join('');
      }
    }

    window.addEventListener('DOMContentLoaded', () => {
      loadPresetScenario('straightforward');
    });
  </script>
</body>
</html>
`;
