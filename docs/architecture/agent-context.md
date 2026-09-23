# Agent Context: Device Lab

**Source baseline:** `main` at `ff660ad637cfa79145929e4f2e7ff594815533b2`.

Device Lab is a local Node/Express browser workspace for Android device interaction and testing. The server exposes REST endpoints and a WebSocket stream; its Android adapter shells out to the Android SDK, while project intake can clone or open a project, build it, install an APK, and launch it. Bug reports collect structured repro details and available screenshot/log/device context in local JSON-backed storage, then export reports.

The main code boundaries are [server.js](../../server.js), [the Android adapter](../../lib/android.js), [project handling](../../lib/projects.js), [bug persistence and export](../../lib/bugs.js), and the plain-browser interface in [public/app.js](../../public/app.js). [README](../../README.md) documents the user workflow; [CONTRIBUTING](../../CONTRIBUTING.md) gives the manual AVD smoke procedure.

The iOS lane uses an external cloud simulator flow; the local Node server does not provide an iOS simulator. Runtime data, device captures, settings, uploads, and imported project clones under `data/` and `workspace/` are excluded from the graph.

The maintained inventory and source relationships are in [../../.ua/knowledge-graph.json](../../.ua/knowledge-graph.json). [Provenance](agent-context-provenance.json) records parser coverage, exclusions, and validation.
