# Device Lab — shared agent guidance

## Preserve the local tool

- Read `README.md`, `CONTRIBUTING.md`, relevant issues/current handoff, and scoped guidance. Keep this local mobile-testing workspace small and dependency-light.
- No frontend framework/build step; plain browser JavaScript is deliberate. New runtime dependencies require prior issue discussion under CONTRIBUTING.
- Preserve localhost-only binding on port 4830 and its no-auth trust boundary. Do not expose it to an untrusted network or turn it into a hosted SaaS without an explicit product/security decision.
- Building an imported repository executes its build logic. Use only trusted projects and controlled paths/arguments; do not run arbitrary downloaded APK/build code on the owner's host as an incidental test.
- Keep Android/adb, project intake/builds, evidence/export, REST, and WebSocket responsibilities separate. iOS uses legitimate remote Apple/cloud tooling; never claim local Windows iOS emulation.
- Treat runtime `data/`, logcat, screenshots, and exports as sensitive. Keep credentials/Appetize settings out of Git, logs, and shared artifacts; inspect and redact reports before sharing.
- Current owner instructions and approved controls govern authority. Preserve any adopted canonical control standard rather than adding another constitution or a cloud-app scaffold.

## Reproducible acceptance

- Use `npm ci` with the existing lockfile. Reconcile compatible Node pins and host prerequisites: Android SDK/adb/emulator/build tools/AVD, JDK 17 for Gradle, and Git.
- `npm start` is the only root manifest script. There is no manifest lint/test/build suite to claim as passing; no frontend build is required.
- Existing smoke: install `testapp/probe.apk`, exercise taps/swipes/text/keys, trigger its deliberate crash, observe logcat/crash feedback, file a bug, and export evidence. Record host OS, AVD/device, exact candidate, and artifacts.
- Any `lib/android.js` change requires a real AVD test. Rebuild the probe with `bash testapp/build.sh` only when changing it and with the documented SDK tools. UI changes need screenshots and real interaction.
- Establish real automated checks incrementally; no placeholder-success scripts or swallowed errors. Demonstrate intentional failure detection when adding/changing the harness; the probe's expected crash is not permission to ignore unrelated failures.
- Use synthetic probe data and local mocks without Production credentials or paid cloud-device calls. Distinguish mocked adb, real AVD, physical hardware, and remote iOS evidence.

## Economical CI and handoff

- Work on one focused acceptance path with non-goals. Fix relevant blockers/invariants; record unrelated cleanup separately. Run narrow local checks before coherent pushes and read full failing logs before reruns.
- Avoid duplicate workflows, speculative pushes, repeated matrices, and unnecessary macOS/emulator jobs. Broaden validation for process execution, paths/uploads, security, dependencies, toolchains, workflows, and agent policy.
- Prose-only routing requires an explicit allowlist; policy/executable Markdown is impact-bearing. Preserve required workflows and a tested final gate rejecting failed/cancelled/missing required work.
- Use least privilege, immutable action references, and untrusted/privileged separation. Cancel superseded PR checks where safe, not device/release operations. Check real release triggers and authorization before merging; do not invent cloud deployment targets.
- Record implemented, wired, locally verified, hosted/remote verified where applicable, and released separately with SHA, command/result, target/device, and evidence. Source presence does not prove device behavior.
- Keep existing issue/checklist/progress records concise and evidence-linked; retain PROJECT_CHECKLIST/PROGRESS where adopted, not duplicate trackers. Archive history safely and report actual checks, blockers, genuine owner actions, and next smallest task.
- Load deeper docs/skills selectively; prefer one implementer plus separate review and confirm fresh Codex/Claude instruction loading.
