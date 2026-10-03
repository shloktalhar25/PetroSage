# PetroSage Complete Repair and Production-Readiness Master Prompt

You are a senior full-stack engineer, product engineer, QA engineer, accessibility specialist, and DevOps-minded maintainer working on the existing **PetroSage** repository. Your task is to repair the project completely and deliver a tested, coherent, production-ready final project—not a prototype, partial patch, visual-only mock, or list of recommendations.

Work directly in the existing repository. Preserve useful functionality and the current product direction, but replace all fake, inert, misleading, or disconnected behavior with real implementations. Do not stop after diagnosing issues. Inspect, implement, test, and verify the complete application end to end.

## 1. Product context

PetroSage is an oil-and-gas intelligence application with:

- A React 19 + Vite frontend.
- A Python FastAPI API.
- A RAG pipeline using Groq, sentence-transformer embeddings, and a custom Rust vector database called DevDB.
- Indexed PDF, spreadsheet, CSV, and text data under `Manual_data/`.
- Pages for market and asset search, intelligence review, upstream operations, midstream operations, regulations/compliance, structured data extraction, and application settings.

The current UI contains a mixture of real RAG calls, hardcoded demonstration data, inert controls, simulated document viewers, fake uploads/downloads, and incomplete production configuration. The finished product must clearly distinguish real indexed data from unavailable functionality and must not represent hardcoded examples as live, verified, or AI-generated results.

## 2. Non-negotiable completion rules

1. Deliver working code, tests, configuration, documentation, and a final verification report.
2. Do not leave TODOs, placeholder handlers, fake alerts, simulated network delays, hardcoded “live” statuses, or controls that appear interactive but do nothing.
3. Do not fabricate documents, citations, legal findings, asset status, extraction results, refresh timestamps, pipeline status, or downloads.
4. Every visible control must either work or be removed/clearly disabled with an explanation.
5. Maintain backward compatibility with existing CLI and RAG behavior wherever practical.
6. Never expose `GROQ_API_KEY` or other server secrets to the browser, logs, repository, API responses, or generated artifacts.
7. Do not swallow failures. Provide normalized backend errors, safe user-facing messages, retry paths, and useful server logs.
8. Use real data from the repository or real backend responses. If a capability cannot operate because a required service is unavailable, show an honest unavailable/degraded state.
9. Avoid a wholesale rewrite unless a smaller, well-structured repair cannot meet the requirements.
10. Preserve unrelated user changes. Inspect the worktree before editing and make narrowly scoped changes.

## 3. Required initial inspection

Before editing:

1. Read `README.md`, `docs/HOW_TO_RUN.md`, `docs/REPO_STRUCTURE.md`, `.env.example`, `requirements.txt`, `frontend/package.json`, `frontend/vite.config.js`, all API routes, adapters, RAG pipeline code, data models, vector-store interfaces, and all frontend pages.
2. Check for repository-level instructions such as `AGENTS.md` and follow them.
3. Record the current git status and do not overwrite unrelated changes.
4. Determine the actual DevDB API, snapshot-loading behavior, source metadata, chunk schema, and available indexed-data capabilities.
5. Run the existing tests before modifications. If dependencies are absent, install them in an isolated environment using the repository manifests. Do not claim a test passed if it was not run.
6. Create a concise implementation plan mapping frontend workflows to backend contracts and tests.

## 4. Target architecture

Use a clear flow:

```text
React route/page
  -> feature component/hook
  -> centralized API client
  -> FastAPI route
  -> service/controller logic
  -> RAG, indexed metadata, source files, or extraction service
```

### Frontend structure

- Centralize HTTP behavior in an API client.
- Use `VITE_API_BASE_URL` for deploy-time frontend configuration, defaulting safely to `/api` for same-origin deployments.
- Keep server-only configuration on the backend.
- Introduce reusable loading, empty, error, retry, offline/degraded, success, and disabled states.
- Use feature-specific hooks or components where page files have become too large.
- Keep state local unless it must persist across routes or reloads.
- Persist appropriate user preferences, settings, bookmarks, and optionally chat sessions using an explicit, versioned storage strategy.
- Do not put sensitive data in browser storage.

### Backend structure

- Keep FastAPI routes thin.
- Put reusable orchestration, file access, extraction, refresh, and settings validation in services.
- Define Pydantic request/response schemas for every endpoint.
- Preserve meaningful 400, 404, 409, 422, 502, and 503 failures.
- Return a stable safe error envelope, for example:

```json
{
  "error": {
    "code": "DEVDB_UNAVAILABLE",
    "message": "The indexed knowledge store is currently unavailable.",
    "retryable": true,
    "request_id": "..."
  }
}
```

- Log request IDs and internal exception context server-side without leaking secrets or full sensitive prompts/documents.
- Resolve filesystem paths relative to the repository/package root, not the process working directory.
- Avoid blocking the async event loop. Use sync routes intentionally or move blocking operations to a thread pool/background task.

## 5. Fix settings completely

Implement a real Settings page and route. Connect both the sidebar Settings icon and “Manage AI Config” button to it.

The Settings page must include only meaningful settings, such as:

- API connection/health display.
- DevDB connection/health display.
- Whether the RAG pipeline is loaded.
- Default jurisdiction/country.
- User-facing theme or display preferences if supported.
- Request timeout preference within safe bounds.
- Optional retrieval settings only if they can safely be changed at runtime; otherwise display them read-only with an explanation.
- Model name and provider status as read-only server metadata. Never display the API key.

Requirements:

- Use a real `/api/settings` or `/api/config/public` contract for safe public configuration.
- Validate all mutable settings.
- Persist user-only preferences locally or via a backend settings store, with explicit ownership.
- Provide Save, Reset, saving, saved, validation-error, and server-error states.
- Add accessible labels and keyboard support.
- Add tests for navigation, persistence, validation, reset, and API failure.

## 6. Fix prompt submission and the refresh-required symptom

Repair all RAG chat surfaces:

- Market and Asset Search.
- Intelligence Review.
- Upstream AI.
- Midstream AI.

Required behavior:

1. A submitted prompt must immediately appear in the conversation.
2. A visible loading state must appear while the request is active.
3. The response must render immediately when received, without reloading or navigating.
4. The message area must scroll correctly without scrolling the whole page unexpectedly.
5. Failure must render as a dedicated error message—not as a successful AI answer.
6. Every retryable failure must provide Retry.
7. Requests must have a configurable timeout using `AbortController`.
8. Add Cancel while a request is running.
9. Prevent unintended duplicate requests while allowing intentional retry.
10. Ensure state cleanup occurs in `finally`, including JSON parse and rendering errors.
11. Handle non-JSON responses and reverse-proxy error pages safely.
12. Preserve the user’s typed prompt when submission fails, or provide a one-click restore/retry.
13. Optionally persist conversations across refresh using versioned local storage; include Clear conversation.
14. Do not allow stale responses from an earlier request to overwrite a newer conversation state.
15. Add an error boundary around chat rendering so malformed response content cannot blank the page.
16. Sanitize/secure Markdown rendering. Do not enable unsafe raw HTML.

Investigate and test the refresh symptom under:

- Successful fast response.
- Slow Groq response.
- DevDB unavailable.
- API unavailable.
- Timeout.
- Invalid/non-JSON proxy response.
- Backend 422, 502, and 503 responses.
- Navigation away and back during a request.
- React Strict Mode in development.
- Production build served separately from the backend.

Add automated tests that prove no browser refresh is required.

## 7. Production-safe API connectivity

Replace the development-only assumption with a deployable contract:

- Frontend API client reads `VITE_API_BASE_URL`, with a documented same-origin default.
- Normalize slashes so `/api` is not duplicated or omitted.
- Keep Vite’s development proxy for local development.
- Add FastAPI CORS configuration driven by a restricted `CORS_ORIGINS` environment variable when cross-origin deployment is used. Never use unrestricted credentials with wildcard origins.
- Document development, preview, same-origin production, and split-origin production commands.
- Add `.env.example` entries without real secrets.
- Add a frontend startup/health indicator and useful connection error.
- Ensure `vite preview` or a production-like static build can reach the configured API.

## 8. Health and degraded-state handling

Expand health reporting so the UI never says “Live” merely because it rendered.

Health should accurately report:

- API process status.
- DevDB connectivity.
- Pipeline loaded/readiness.
- Snapshot/index availability.
- Groq key configured (boolean only, never its value).
- Embedding model readiness if practical.
- Last successful refresh/ingestion metadata if known.

Create separate liveness and readiness concepts if useful. The frontend must display healthy, degraded, unavailable, and checking states. Disable dependent actions with a reason when required services are unavailable.

## 9. Replace mock document search with real behavior

The “All Documents” and “Saved” tabs must use real indexed/source metadata rather than the hardcoded `RESULTS` array.

Implement backend endpoints for:

- Paginated document listing.
- Text search.
- Filters for document type, basin/area when metadata exists, jurisdiction/country, and status when metadata exists.
- Document metadata/details.
- Source-page or source-row retrieval where permitted.
- Secure document download where appropriate.

Requirements:

- Never invent missing metadata. Use `null`/“Unknown” honestly.
- Validate pagination and filter values.
- Prevent path traversal; source access must be restricted to approved data roots.
- Use stable document IDs independent of display names.
- Apply every visible filter or remove unsupported filters.
- Provide real result counts, pagination state, empty states, and loading/error states.
- Make document titles actionable.
- Persist bookmarks locally or in a backend store; bookmarks must survive refresh.
- Add tests for combined filters, pagination boundaries, search, no results, saved items, invalid IDs, and path traversal attempts.

## 10. Build a truthful document and citation viewer

Replace simulated viewer content with actual cited content.

Requirements:

- A citation opens the correct source and page/row/chunk.
- PDF pages render from the actual PDF or a secure backend rendering endpoint.
- Spreadsheet/CSV citations show the actual row and useful headers.
- Text citations show the actual relevant excerpt with surrounding context.
- Page totals come from the document, not a constant.
- Previous/Next enforce correct bounds.
- Zoom in/out actually works and has limits.
- Download returns the real authorized file with correct filename and media type.
- Highlight the cited passage where technically practical; otherwise clearly show the cited excerpt alongside the page.
- If a source file is missing, show a truthful missing-source error.
- Never display generic fabricated content labeled “RAG verified.”
- Use stable citation/source IDs and ensure adapter parsing cannot associate a citation with the wrong file.
- Test filenames with spaces, duplicate page numbers across files, spreadsheet rows, missing files, and invalid source IDs.

## 11. Intelligence Review and refresh workflow

Replace the hardcoded “Last Updated,” “Next refresh,” files, FAQ count, pipeline status, and FAQs with real backend data.

Implement:

- A refresh/status endpoint.
- A safe refresh/ingestion job mechanism.
- One active refresh at a time, returning 409 for conflicts.
- Job state: queued, running, succeeded, failed, and cancelled if cancellation is supported.
- Progress or step status based on actual work.
- Last successful refresh timestamp.
- Error details safe for users and full diagnostics in logs.
- “Refresh Now” that starts the real job and polls or streams status.
- Disable the button while a job is active.
- Generated FAQs only if they are actually generated and stored; otherwise replace that section with a truthful RAG insights interface.

Do not block an HTTP request for the full ingestion duration. Do not report nightly refresh unless a scheduler genuinely exists and is documented.

## 12. Upstream and midstream data integrity

Replace frontend hardcoded asset arrays with backend-served real datasets from the repository.

Requirements:

- Parse and validate the relevant upstream/midstream CSV files server-side.
- Return typed asset schemas.
- Handle invalid coordinates and missing fields without crashing the whole page.
- Clearly label dataset timestamps and whether status is static, imported, or live.
- Never use “Live” unless data is actually live and periodically updated.
- Ensure map counts match visible/loaded assets.
- Keep layer toggles functional.
- Make asset detail and AI prompts use the same canonical asset IDs.
- AI highlights must reference existing canonical IDs only.
- If routing geometry is not available, do not imply that a route was computed. Clearly call the output a recommendation and avoid drawing fabricated route lines.
- Handle map-tile network failures with a fallback message while retaining asset lists/details.
- Add loading, empty, partial-data, and error states.
- Test CSV parsing, asset endpoints, layer filtering, map highlighting, unknown asset IDs, and malformed records.

## 13. Regulations and compliance workflow

The current upload is simulated and the findings are hardcoded. Replace this with a real workflow or remove unsupported claims.

Implement a secure document-analysis flow:

- Accept only documented file types and validate MIME type, extension, file size, and content.
- Store uploads in a controlled temporary/work directory using generated IDs, not user-supplied paths.
- Prevent path traversal and executable content handling.
- Extract text using the project’s existing loaders where possible.
- Run compliance analysis against actual indexed regulation sources.
- Return findings that include severity, proposal excerpt, supporting law source, page/row, explanation, confidence/limitations, and remediation guidance.
- Explicitly state that the output is machine-assisted and not legal advice.
- Do not claim a violation unless supported by a cited source and deterministic/traceable reasoning.
- Provide upload progress, analyzing, completed, failed, retry, and cancel/clear states.
- The document viewer must show actual uploaded content and jump to actual findings.
- Generate a real redlined artifact only if implemented reliably; otherwise remove the download button rather than using an alert.
- Clean up temporary files according to a documented retention policy.
- Add tests for valid upload, invalid type, oversized file, malformed file, missing legal sources, analysis failure, cleanup, and safe download.

If full redline generation is outside the current product scope, deliver a real downloadable compliance report instead and label it accurately.

## 14. Structured data extraction workflow

Replace static extraction templates and modals with real extraction records.

Implement:

- Endpoint(s) listing completed/active extraction jobs.
- Search that actually filters results.
- Job detail with input source, template, status, timestamps, row/table counts, validation status, and errors.
- Actual CSV/table preview from generated extraction output.
- Secure real CSV download.
- AI validation only if the backend performs it; include loading, results, citations/traceability, and failure states.
- Correct Summary and Content tabs backed by actual job data.
- Remove fake dates, durations, counts, completion badges, and alert-only downloads.
- Add tests for list/search, preview, download, empty state, missing output, invalid ID, and AI validation failure.

## 15. Error handling and resilience

Create a shared frontend error model and backend error codes.

At minimum handle:

- `API_UNREACHABLE`
- `REQUEST_TIMEOUT`
- `REQUEST_CANCELLED`
- `INVALID_RESPONSE`
- `VALIDATION_ERROR`
- `DEVDB_UNAVAILABLE`
- `PIPELINE_UNAVAILABLE`
- `MODEL_PROVIDER_UNAVAILABLE`
- `SOURCE_NOT_FOUND`
- `UNSUPPORTED_FILE`
- `FILE_TOO_LARGE`
- `REFRESH_IN_PROGRESS`
- `INTERNAL_ERROR`

Frontend messages must be concise and actionable. Backend logs must retain enough detail for debugging. Add a request ID to errors and show it in expandable technical details.

Do not return raw internal exception strings to users. Do not log API keys, authorization headers, full environment data, or sensitive uploaded contents.

## 16. Encoding and content cleanup

Fix all mojibake and corrupted characters such as `â€”`, `â€¦`, `Â·`, and broken emoji.

- Ensure source files are UTF-8.
- Use plain text or valid Unicode consistently.
- Add an automated scan/test that catches known mojibake sequences in frontend source and user-facing backend strings.
- Update documentation containing corrupted characters.

## 17. Accessibility requirements

Meet WCAG 2.1 AA expectations for the repaired workflows:

- Use semantic buttons, links, forms, headings, dialogs, and navigation.
- Add accessible names to every icon-only button.
- Make all actions keyboard-operable.
- Provide visible focus states.
- Use `aria-live` for request progress and errors where appropriate.
- Manage focus when dialogs open/close.
- Support Escape to close dialogs where safe.
- Add dialog labels and focus trapping.
- Do not use clickable `div` or `span` elements where buttons/links belong.
- Ensure checkbox/radio labels are associated correctly.
- Ensure disabled controls explain why when needed.
- Check contrast and touch target sizes.
- Respect `prefers-reduced-motion`.
- Make maps have a non-map list/table alternative.

Add focused accessibility tests using the frontend test stack and an automated accessibility checker where practical.

## 18. Responsive design requirements

Verify at approximately 360, 768, 1024, 1440, and 1920 CSS pixels.

- Replace fixed split layouts with responsive stacking/drawers/tabs where needed.
- Ensure sidebars do not hide core content.
- Avoid accidental horizontal page scrolling.
- Make chat input reachable with the on-screen keyboard.
- Ensure dialogs and document viewers fit small screens.
- Preserve usable map/list access on mobile.
- Test long filenames, long answers, Markdown tables/code, and large citation lists.

## 19. Security requirements

- Keep secrets server-side.
- Restrict CORS.
- Validate and normalize all input.
- Enforce upload limits.
- Prevent path traversal for documents and downloads.
- Use generated identifiers rather than accepting filesystem paths from clients.
- Escape/safely render untrusted data.
- Do not enable unsafe Markdown HTML.
- Add reasonable API rate limiting or document the reverse-proxy requirement, particularly for expensive RAG and upload endpoints.
- Limit prompt length consistently in frontend and backend.
- Limit response/source payload sizes.
- Protect refresh/ingestion and configuration mutation endpoints with an authorization mechanism suitable for the deployment. If authentication is not otherwise present, introduce a minimal documented admin-token strategy server-side and never embed it in public frontend builds; alternatively keep privileged actions disabled unless an authenticated deployment mechanism is configured.
- Avoid exposing absolute filesystem paths in API payloads.
- Add security tests for malformed requests, traversal, oversized prompts/uploads, unsupported MIME types, and unsafe filenames.

## 20. Configuration and path fixes

- Resolve `Manual_data`, `index`, snapshot, chunks, metadata, and other repository paths from a stable project root.
- Allow environment overrides using documented variables.
- Replace the single hardcoded Hugging Face snapshot revision assumption with robust cache/model resolution.
- Support offline cached model use without assuming one hash.
- Validate configuration at startup and expose only safe readiness information.
- Update `.env.example` with variables such as:

```dotenv
GROQ_API_KEY=
DEVDB_URL=http://127.0.0.1:8080
VECTOR_BACKEND=rust
CORS_ORIGINS=http://localhost:5173
PETROSAGE_DATA_DIR=
PETROSAGE_INDEX_DIR=
RAG_REQUEST_TIMEOUT_SECONDS=120
VITE_API_BASE_URL=/api
```

Use the correct division: `VITE_*` belongs in a frontend environment example; server variables belong in the backend/root environment example. Never add real credentials.

## 21. Testing requirements

Create or extend tests covering all repaired behavior.

### Backend

- Unit tests for services and adapters.
- API contract tests using FastAPI’s test client or `httpx` test transport.
- Mock Groq, embeddings, filesystem, and DevDB where appropriate.
- Keep a clearly marked optional live DevDB integration suite.
- Test error-code preservation and safe error messages.
- Test source/citation mapping, duplicate filenames, rows/pages, country filtering, and no-result behavior.
- Test settings, document listing/viewing/download, assets, refresh jobs, uploads/compliance, and extraction endpoints.

### Frontend

Set up an appropriate test runner if absent, such as Vitest + React Testing Library.

- Test routing and Settings navigation.
- Test every visible control.
- Test prompt success without refresh.
- Test timeout, cancel, retry, API failure, invalid JSON, and stale requests.
- Test filters, pagination, bookmarks persistence, document navigation, downloads, settings validation, refresh state, uploads, extraction search, and responsive component states.
- Mock API responses at the network boundary.
- Add at least one browser-level end-to-end suite, preferably Playwright, for critical flows.

### Rust/DevDB

- Run existing Rust unit and integration tests.
- Add tests only where API behavior required by the repairs changes.

## 22. Required verification commands

Use the repository’s actual environment and adjust commands for Windows/Linux as appropriate. At minimum run and report:

```bash
python -m pytest -q
cd frontend && npm run lint
cd frontend && npm run test -- --run
cd frontend && npm run build
cd db/DevDB && cargo test --all-targets
```

Also run:

- Python formatting/lint/type checks if configured.
- Frontend end-to-end tests.
- A production-like frontend/API smoke test.
- Health endpoint smoke tests with DevDB both available and unavailable.
- A real prompt test when credentials/services are available; otherwise use a deterministic mocked provider and explicitly report the live-test limitation.

Do not mark the task complete with failing tests. If an external service prevents a live test, ensure deterministic automated coverage exists and describe the exact external limitation.

## 23. Documentation and developer experience

Update documentation so a new developer can run the entire project reliably.

Document:

- Prerequisites: supported Python, Node, and Rust versions.
- Virtual environment creation on Windows and Unix.
- Dependency installation.
- Environment files and each variable.
- Starting DevDB.
- Ingestion/index creation.
- Starting FastAPI.
- Starting Vite.
- Production build/deployment options.
- Running every test suite.
- Troubleshooting API unreachable, DevDB unavailable, missing snapshot, missing Groq key, slow first model load, CORS, and proxy configuration.
- Which features require privileged/admin access.
- Which data is imported/static versus genuinely live.

Correct stale README language claiming the frontend is only a placeholder.

## 24. Definition of done by page

### Global navigation

- Every navigation icon works and has a tooltip plus accessible name.
- Active route is correct.
- Settings opens a functioning page.
- Unknown routes show a useful 404 page.

### Market & Asset Search

- Real documents, real filters, real pagination, persistent bookmarks, real citations/viewer/downloads, and reliable AI chat.

### Intelligence Review

- Real status/metadata, truthful freshness, working refresh job, and reliable market RAG.

### Upstream

- Backend-sourced assets, truthful data freshness, usable map/list, real AI response and citations.

### Midstream

- Backend-sourced assets, functional layers/details, accurate AI highlighting, no fabricated routing.

### Regulations

- Real secure upload and traceable compliance analysis, or an honestly reduced scope without fake controls.

### Data Extraction

- Real jobs/search/previews/downloads/validation, or an honestly reduced scope without fake records.

### Settings

- Working navigation, health/config display, validated preferences, persistence, reset, and safe failure states.

## 25. Final acceptance checklist

Before final delivery, confirm all of the following with evidence:

- [ ] No application code contains known mojibake sequences.
- [ ] No user-facing button is inert.
- [ ] No fake download uses `alert()`.
- [ ] No fake upload uses only `setTimeout()`.
- [ ] No hardcoded data is described as live, indexed, generated, or verified.
- [ ] Prompt responses render without browser refresh.
- [ ] Prompt timeout, cancellation, retry, and error UI work.
- [ ] Production API base URL is configurable.
- [ ] Settings works.
- [ ] Filters and pagination work.
- [ ] Bookmarks survive refresh.
- [ ] Citations open real source content.
- [ ] Document navigation and zoom are bounded and functional.
- [ ] Downloads return real files.
- [ ] Health/status labels reflect actual backend state.
- [ ] Refresh/ingestion is a real tracked job.
- [ ] Upstream/midstream assets come from backend data.
- [ ] Regulations and extraction are real or explicitly and honestly unavailable.
- [ ] Backend errors use safe stable codes.
- [ ] Filesystem paths are independent of the launch directory.
- [ ] Keyboard and screen-reader-critical flows work.
- [ ] Mobile/tablet/desktop layouts are usable.
- [ ] Python tests pass.
- [ ] Frontend lint, tests, and build pass.
- [ ] Rust tests pass.
- [ ] End-to-end critical flows pass.
- [ ] Documentation matches the final implementation.
- [ ] No secrets or generated dependency/build/cache artifacts are committed.

## 26. Required final response format

After completing the project, provide:

1. **Outcome** — a concise statement that the repaired project is complete.
2. **Implemented changes** — grouped by frontend, backend, data/RAG, security, accessibility, and documentation.
3. **API contract summary** — endpoints added or changed.
4. **Verification evidence** — exact commands and pass/fail counts.
5. **Manual smoke-test evidence** — critical user flows exercised.
6. **Environment/deployment notes** — required variables and startup commands.
7. **Remaining limitations** — only genuine external limitations; do not hide incomplete work here.
8. **Files changed** — concise grouped list.

Do not respond with only code snippets, a plan, or instructions for someone else. Implement the changes in the repository and hand back the final working project.
