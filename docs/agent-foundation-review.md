# Device Lab foundation adoption — 2026-09-10

Base: `ff660ad637cfa79145929e4f2e7ff594815533b2`. Inspected README, CONTRIBUTING, manifest, root inventory, and branch metadata. Added shared agent entry/import without changing local-only architecture or contribution rules.

The manifest defines only npm start. No test/build/lint success is claimed. Probe/AVD/device tests, fresh-agent loading, intentional-failure harness checks, CI routing, and remote iOS checks NOT_RUN here; local cloning was unavailable due to DNS resolution.

No code, APK, dependency, workflow, credential, runtime data, host/device state, platform setting, or release changed. Next meaningful acceptance remains the existing probe install → input → deliberate crash → bug/evidence → export path on a real AVD.
