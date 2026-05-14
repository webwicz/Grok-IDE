# Plan: Grok-IDE — vscode-copilot-chat Inspired Improvements + xAI API Modernization

## Goal
Four phases, vanilla JS frontend + Node/Express backend:
0. ⚠️ URGENT: Migrate to Responses API + grok-4.3 (model retiring TODAY May 15)
1. Chat UI Polish (thinking/reasoning stream, better code blocks, attachment pills)
2. Inline Diff Editor (Monaco diff view with accept/reject)
3. AI Tool Calling (built-in server-side tools + custom file tools + WebSocket agentic loop)

---

## Phase 0: URGENT — Responses API + grok-4.3 Migration

*Must happen first; unblocks all other phases. Independent of Phases 1-3.*

### 0.1 Model Update
- **Where**: `src/config/config.js` and `src/services/aiService.js`
- Replace `grok-4-0709` / `grok-beta` with `grok-4.3`
- Add `reasoning_effort` field to config: default `"low"` for chat/code, override to `"high"` for review mode
- Remove `presencePenalty`, `frequencyPenalty`, `stop` params — incompatible with reasoning models

### 0.2 Migrate to Responses API
- **Where**: `src/services/aiService.js` and `src/controllers/aiController.js`
- Change endpoint from `POST /v1/chat/completions` to `POST /v1/responses`
- Rename `messages` → `input` in request body
- Response body changes: `choices[0].message.content` → `output[0].content[0].text`
- For streaming: `choices[0].delta.content` → same, but also capture `reasoning_content` deltas
- Implement `previous_response_id` chaining: backend stores last `response.id` per session in SQLite; on next turn, pass it instead of resending full history (eliminates re-billing of history tokens)

### 0.3 Stream Reasoning Content
- **Where**: `src/controllers/aiController.js` — SSE emitter; `public/js/ai-streaming.js` — renderer
- Add new SSE event type `reasoning` alongside `content`
- Backend: when `chunk.reasoning_content` arrives, emit `data: {"type":"reasoning","content":"..."}`
- Frontend: render into a collapsible `.ai-reasoning-block` above the response (collapsed by default, expand on click) — shows Grok's summarized thinking

### 0.4 Reasoning Effort Selector in UI
- **Where**: `public/GrokIDE.html` — AI mode selector area
- Add a `<select id="reasoningEffort">` with options: Fast (none) / Standard (low) / Thoughtful (medium) / Deep (high)
- Wire to request body in `ai-streaming.js` `sendMessage()`

---

## Phase 1: Chat UI Polish

### 1.1 Thinking Indicator
- **Where**: `public/js/ai-streaming.js` — inside `streamResponse()` before first chunk arrives (lines 115-182)
- Add a `showThinking()` method that inserts a `.ai-thinking` div with animated dots into `#aiContent`
- Remove it when first real token arrives
- **CSS**: add `.ai-thinking`, `@keyframes thinking-pulse` to `public/css/components.css`

### 1.2 Better Code Block Component
- **Where**: `formatMessage()` in `ai-streaming.js` (line 260)
- Replace bare `<pre><code>` with a `.code-block-wrapper` component:
  - Header bar: language badge + filename (parse ` ```lang filepath ` pattern)
  - Action buttons: Copy | Apply to Editor | View Diff (if filepath detected) | Create File
- **CSS**: `.code-block-wrapper`, `.code-block-header`, `.code-block-actions` in `components.css`

### 1.3 Attachment Pills (File Context)
- **Where**: New file `public/js/context-attachments.js`
- `ContextAttachments` class tracks attached items (open file, selection, custom file)
- Renders pill chips above `#aiPrompt` textarea inside `.ai-input-area`
- On send, serializes attached context and appends to request `context` field
- Wire into `public/GrokIDE.html`: add "Attach" button (📎) next to Send; add `.attachment-pills` container div
- **CSS**: `.attachment-pills`, `.attachment-pill`, `.pill-remove` in `components.css`

### 1.4 Confirmation Buttons in Chat
- **Where**: `ai-streaming.js` — new method `addConfirmationMessage(question, onAccept, onReject)`
- Renders a `.ai-confirmation` div with Accept/Reject buttons
- Used by tool calling phase when AI proposes destructive writes
- **CSS**: `.ai-confirmation`, `.confirm-btn`, `.reject-btn` in `components.css`

---

## Phase 2: Inline Diff Editor

### 2.1 Monaco Diff Editor Integration
- **Where**: `public/js/monaco-integration.js` — new method `showDiff(originalContent, newContent, filePath)`
- Use `monaco.editor.createDiffEditor()` inside a new `.diff-overlay` modal panel
- Overlay sits above main editor area (position: fixed, z-index high)
- Header: file path breadcrumb + Accept Changes / Reject buttons
- On Accept: call `editor.setValue(newContent)` on main editor + save file

### 2.2 Trigger from Code Blocks
- **Where**: `ai-streaming.js` — code block component (Phase 1.2)
- When code block has a detected filepath and that file is already open in Monaco: show "View Diff" button
- "View Diff" calls `window.monacoEditor.showDiff(currentContent, codeBlockContent, filepath)`

### 2.3 CSS
- `.diff-overlay`, `.diff-header`, `.diff-actions`, `.diff-accept-btn`, `.diff-reject-btn` in `components.css`
- Overlay uses same backdrop/modal pattern as existing `.insertion-preview`

---

## Phase 3: AI Tool Calling *(parallel with Phase 1; depends on 1.4 for confirmations)*

### 3.1 Built-in Server-side Tools (zero backend code — xAI executes these)
- **Where**: `src/controllers/aiController.js` — pass `tools` array to Responses API
- Include in every request: `{ type: "web_search" }`, `{ type: "x_search" }`, `{ type: "code_execution" }`
- xAI executes these; tool events still stream via `chunk.tool_calls` for UI display cards
- No new backend services needed for these three

### 3.2 Custom Client-side Tool Definitions
- **New file**: `src/services/toolService.js`
- Define 5 custom JSON Schema function tools:
  - `read_file(path)` — fs.readFile, capped at 10k chars
  - `list_directory(path)` — fs.readdir with file stats
  - `search_code(query, directory)` — recursive grep via child_process
  - `run_command(command)` — exec with 10s timeout *(requires user confirmation)*
  - `write_file(path, content)` — *(requires user confirmation)*
- Export `toolDefinitions` array + `executeTool(name, args)` async function

### 3.3 Custom Tool Execution Loop (Backend)
- **Where**: `src/controllers/aiController.js` — update streaming endpoint
- When `tool_calls` arrives for a custom tool: pause SSE stream, call `toolService.executeTool()`, append `function_call_output` to input, continue with `previous_response_id`
- For `run_command` / `write_file`: emit `tool_confirm` SSE event instead of executing; await `/api/tool-confirm` resolution

### 3.4 Tool Invocation Cards (Frontend)
- **Where**: `public/js/ai-streaming.js` — handle SSE event types
- `chunk.tool_calls` → `.tool-card` with spinner + tool name + args (server-side and custom tools)
- `tool_result` → update card, collapse result (expand on click)
- `tool_confirm` → `.ai-confirmation` dialog (Phase 1.4)
- **CSS**: `.tool-card`, `.tool-card-header`, `.tool-card-body`, `.tool-spinner` in `components.css`

### 3.4 WebSocket Agentic Loop
- **Where**: `src/services/aiService.js` — new `AgentWebSocketSession` class
- Open `wss://api.x.ai/v1/responses` once per chat session (25-min limit, reconnect on close)
- Each turn: send `response.create` with `previous_response_id` + only new input items
- Dramatically cuts latency on multi-turn tool loops (~20% per xAI benchmarks)
- Fallback: if socket drops, revert to HTTP Responses API with `previous_response_id`

### 3.5 New API Endpoints
- **Where**: `src/routes/api.js`
- `POST /api/tool-confirm` — `{ sessionId, toolCallId, approved: bool }` — resolves pending promise in controller
- No new packages needed; use Node.js built-in `ws` or `websocket` npm package (already likely available)


---

## Phase 4: Memory System + Dreaming Service

*Inspired by OpenClaw's 3-tier memory + phase-based dreaming and Claude's async Dreams API. Fully self-contained within Grok-IDE using grok-4.3 as the dreaming model.*

### Memory Architecture (OpenClaw-style 3 tiers)

| File | Purpose | When loaded into AI |
|---|---|---|
| `MEMORY.md` | Long-term: durable facts, preferences, project decisions | Every request (system prompt) |
| `memory/YYYY-MM-DD.md` | Daily working notes: session summaries, observations | Today + yesterday only |
| `DREAMS.md` | Dream diary: human-readable audit of dreaming runs | Never (UI only) |

Files live at configurable `MEMORY_PATH` (default: `~/.grok-ide/memory/`). Short-term candidates live in SQLite table `memory_short_term` (scored entries staged for promotion).

---

### 4.1 Memory Storage Service
- **New file**: `src/services/memoryService.js`
- Functions:
  - `getSystemContext()` — reads MEMORY.md + today/yesterday daily note → returns string injected into AI system prompt `input[0]`
  - `saveTodayNote(content)` — append to `memory/YYYY-MM-DD.md`
  - `saveShortTerm(entry, signals)` — insert into `memory_short_term` SQLite table with `{ content, source_session_id, frequency, recency_ts }`
  - `searchMemory(query)` — keyword grep across MEMORY.md + daily notes (exact match + substring)
  - `getMemoryFile(filename)` — read specific memory file
- Wire `getSystemContext()` into `src/controllers/aiController.js`: prepend to every Responses API `input` array as a `system` message

### 4.2 Memory Tools (add to toolService.js)
Three new custom function-calling tools alongside the existing filesystem tools:
- `memory_search(query)` — calls `memoryService.searchMemory()`, returns top 10 matching lines with source filenames
- `memory_save(content, tier)` — `tier: "short"` stages to SQLite short-term pool; `tier: "long"` appends directly to MEMORY.md
- `memory_get(path)` — calls `memoryService.getMemoryFile()`, returns file contents

### 4.3 Auto Memory Flush
- **Where**: `src/controllers/aiController.js` — after streaming response completes
- When a session turn ends: fire a silent follow-up call to grok-4.3 with `reasoning_effort: "none"`:
  > "Review this conversation turn. If any facts, preferences, decisions, or project context are worth remembering, call `memory_save` now. Be selective — only durable facts, not transient details."
- This mirrors OpenClaw's auto-flush before compaction
- Run async, non-blocking — user never sees this turn

### 4.4 Dreaming Service — 3-Phase Pipeline
- **New file**: `src/services/dreamingService.js`
- Scheduled via `node-cron` (new dependency): default `"0 3 * * *"` (3am daily), configurable in settings
- Status tracked in SQLite table `dreams` with `{ id, status, started_at, ended_at, phases_complete, diary_entry }`

**Light Phase** — sort and stage:
- Read all `memory/YYYY-MM-DD.md` files from last 7 days
- Query `memory_short_term` table, compute frequency/recency scores
- Sort candidates by composite score; write `memory/.dreams/candidates.json`
- No MEMORY.md writes

**REM Phase** — reflect on themes:
- Call grok-4.3 (`reasoning_effort: "low"`, no tools) with recent daily notes:
  > "Identify 3-5 recurring themes or patterns across these notes. What topics appear repeatedly? What user preferences emerge?"
- Append themed summary to `DREAMS.md` as diary entry
- No MEMORY.md writes

**Deep Phase** — promote and clean (inspired by Claude Dreams):
- Read MEMORY.md + top N scored candidates from Light phase
- Call grok-4.3 (`reasoning_effort: "medium"`, `memory_save` tool enabled) with:
  > "You are auditing this agent's long-term memory. 1) Remove duplicates and contradictions. 2) Update stale facts with fresher information from the candidates. 3) Promote high-value candidates (score > threshold) into long-term memory. 4) Preserve the compact structure of MEMORY.md — it should remain scannable, not a transcript."
- AI calls `memory_save(content, "long")` for promotions; backend writes to new temp file first
- **Never overwrites MEMORY.md in-place** — writes `MEMORY.draft.md`, then swaps atomically on success
- Appends final diary entry to `DREAMS.md` with: items promoted, items removed, items updated, reasoning summary

**Scoring signals** (adapted from OpenClaw's 6-signal model):
- `frequency` (0.24) — times entry appeared in short-term pool
- `relevance` (0.30) — how often it was surface in `memory_search` calls
- `recency` (0.15) — time-decayed freshness
- `query_diversity` (0.15) — distinct session contexts that surfaced it
- `consolidation` (0.10) — multi-day recurrence
- `conceptual_richness` (0.06) — length × topic density estimate

### 4.5 Dreams UI Panel
- **Where**: Add "Dreams" tab to bottom panel in [GrokIDE.html](Grok-IDE/public/GrokIDE.html) alongside Terminal/Console/Tasks
- **New file**: `public/js/dreaming-ui.js` — `DreamingUI` class
- Panel shows:
  - Dreaming enabled toggle + next scheduled run time
  - Last run: status badge (completed/failed) + timestamp + token usage
  - "Dream Now" manual trigger button → `POST /api/dreaming/trigger`
  - DREAMS.md diary reader (scrollable, auto-refreshes)
  - Short-term memory count + promoted today count
- Memory sidebar toggle: button in AI panel header opens side drawer with MEMORY.md contents (editable inline)

### 4.6 New API Endpoints (add to src/routes/api.js)
- `GET /api/memory` — return MEMORY.md content
- `PUT /api/memory` — update MEMORY.md content (from sidebar editor)
- `GET /api/memory/dreams` — return DREAMS.md content + last dream status
- `POST /api/dreaming/trigger` — manually kick off a full dream sweep
- `GET /api/dreaming/status` — current status, next scheduled run, dream history

---

## Updated Files Modified (all phases)

- `src/config/config.js` — grok-4.3, reasoning_effort, MEMORY_PATH
- `src/services/aiService.js` — Responses API, WebSocket session class
- `src/controllers/aiController.js` — Responses API, reasoning, tool loop, memory flush
- `src/routes/api.js` — /api/tool-confirm, /api/memory/*, /api/dreaming/*
- `src/services/toolService.js` — filesystem tools + memory_search/save/get tools
- `public/js/ai-streaming.js` — reasoning block, thinking dots, code block rewrite, tool cards
- `public/js/monaco-integration.js` — diff editor method
- `public/css/components.css` — all new UI classes (dreaming panel, memory drawer, tool cards)
- `public/GrokIDE.html` — reasoning selector, attachment container, diff overlay, Dreams tab
- **New**: `public/js/context-attachments.js`
- **New**: `src/services/memoryService.js`
- **New**: `src/services/dreamingService.js`
- **New**: `public/js/dreaming-ui.js`
- **New dep**: `node-cron` (for dreaming scheduler)

---

## Updated Verification
1. Phase 0: grok-4.3 works; reasoning effort selector changes depth; old model slugs gone
2. Phase 1: Thinking dots, better code blocks with action buttons, attachment pills
3. Phase 2: Monaco diff view with Accept/Reject
4. Phase 3: web_search, code_execution, custom tool cards, write/run confirmation
5. Phase 4:
   - Memory contents appear in every AI system prompt (inspect via browser network tab)
   - Ask AI "remember my preference for TypeScript" → appears in MEMORY.md within session
   - `memory_search("typescript")` returns the saved preference
   - Trigger "Dream Now" → status cycles pending→running→completed, DREAMS.md updates
   - MEMORY.md before/after dreaming: duplicates removed, stale entries updated
   - Dreams panel shows diary entry with promoted/removed counts
6. `npm test` passes; `node-cron` does not break server startup

## Decisions
- Memory files are human-readable Markdown in configurable `MEMORY_PATH` (not DB-only)
- Dreaming never modifies MEMORY.md in-place — draft→atomic swap only
- Auto memory flush is silent/async (non-blocking, never interrupts user flow)
- No external embedding provider required — keyword search only by default
- node-cron is the only new dependency
- Dreaming uses grok-4.3 with reasoning_effort "medium" for deep phase, "none" for flush

- `src/services/aiService.js` — Responses API migration, WebSocket session class
- `src/controllers/aiController.js` — Responses API format, reasoning stream, tool calling loop
- `src/routes/api.js` — /api/tool-confirm endpoint
- `public/js/ai-streaming.js` — reasoning block, thinking indicator, code block rewrite, tool SSE events
- `public/js/monaco-integration.js` — diff editor method
- `public/css/components.css` — all new UI classes
- `public/GrokIDE.html` — reasoning effort selector, attachment pill container, attach button, diff overlay
- **New**: `public/js/context-attachments.js`
- **New**: `src/services/toolService.js`

---

## Verification
1. **Phase 0**: Chat works with grok-4.3; reasoning summary collapses/expands; old models no longer hard-coded
2. **Phase 1**: Thinking dots appear before first token; code blocks show language badge + copy/apply/diff buttons; attach file → pill chip, content in request
3. **Phase 2**: "View Diff" on a code block with filepath → Monaco diff opens, Accept/Reject work
4. **Phase 3**: Ask "search the web for X" → web_search tool card shows; ask "run python calc" → code_execution card; ask "list files in src/" → custom tool card; ask to write file → confirmation dialog
5. `npm test` passes

## Decisions
- Vanilla JS only — no framework migration
- Phase 0 is urgent (models retire today); can be done independently + in parallel with Phase 1 CSS/UI work
- Built-in server-side tools (web_search, code_execution) require zero backend code — just pass in `tools` array
- Custom filesystem tools (read, list, search, write, run) remain client-side with confirmation for destructive ops
- WebSocket for agentic multi-tool loops; SSE for simple single-turn responses (keep both paths)
- `previous_response_id` chaining eliminates re-billing conversation history tokens on every turn
- Reasoning effort selector exposed in UI; default low for speed, high for Review mode
- Diff editor as overlay modal (same pattern as existing `.insertion-preview`)
