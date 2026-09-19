# n8n Workflow Change Process — Repository Is the Source of Truth

Applies to every workflow under `n8n-workflows/` (Source Intelligence Analyzer, Job
Ingestion Pilot Orchestrator, CV Analysis Worker, and any future workflow). Restates
and makes concrete the rule already stated in `AGENTS.md` §34 ("Never change,
activate, publish, or overwrite a live n8n workflow without explicit user approval.
Edit the versioned source... and get explicit sign-off before importing or
publishing to the running n8n instance").

## The five-step sequence

1. **Modify workflow source in the repository** (`n8n-workflows/*.ts`) — never the
   live n8n editor.
2. **Review the diff** — read back exactly what changed before it goes anywhere
   near n8n.
3. **Validate the workflow source** (`validate_workflow` via the n8n MCP, or
   equivalent) — catches structural/syntax errors before a live write is attempted.
4. **Only then update live n8n** — with explicit human sign-off for that specific
   change, and only via a full, self-contained operation (see "Incident" below for
   why partial/path-based operations are risky).
5. **Re-read the live workflow immediately after** — diff it against the intended
   result, not just trust a success response from the update call.

The n8n browser editor should not be used as the primary modification source for
these workflows. If a browser tab has one of them open while an MCP-driven update
happens, its next autosave can silently overwrite the change — see
`docs/job-ingestion-pilot.md` §17 for the specific mechanism. Keep editor tabs on
these workflows closed (or navigated away) except for human review after an MCP
update is already complete.

## Incident (2026-09-19): why step 4 must use full, self-contained operations

While applying an environment-variable configuration fix to the Source Intelligence
Analyzer, a `setNodeParameter` call used a JSON Pointer path
(`/parameters/assignments/assignments/1/value`) intended to reach index 1 of the
node's existing `assignments` array. Instead of updating that array element, n8n
accepted the path literally and created a spurious nested
`parameters.parameters.assignments.assignments["1"].value` structure inside the
node — the real assignments array was left untouched, and the malformed write
caused two unrelated nodes (`Load Candidate Sources`, `Daily Schedule Trigger`) to
revert to stale values in the same save.

**Root cause:** a partial-path (`setNodeParameter`) operation on a nested object
field, where the path calculation didn't match the node's actual parameter shape.
**Not** browser autosave — confirmed empirically, since the state was stable and
unchanged after the editor tab was closed.

**Rule going forward:** prefer `updateNodeParameters` with `replace: true` and the
complete, exact parameters object for any node being changed, over `setNodeParameter`
with a computed nested path into an array or deeply nested object. A full replace is
verifiable by eye before sending; a partial path into an array index is not, and a
wrong index/path silently writes to the wrong place instead of failing loudly.
