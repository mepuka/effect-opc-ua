Refactor Plan: Effect Docs → OPC UA NodeSet MCP
🎯 Goal
Replace the current Effect documentation tooling with an OPC UA–focused implementation that still exposes a query → search results → detail lookup workflow, but enriches content with graph-aware context extracted from NodeSet XML and surfaces separate “how-to / best practice” resources.

Phase 0 – Discovery & Target Alignment
Review data sources

Enumerate the official NodeSet XML bundles we need (core spec, DI, ADI, etc.).

Identify supplemental best-practice docs, naming conventions, tutorials to expose as separate resources.

Decide tool naming & surface

Keep one toolkit that mirrors today’s search/get interface (opcua_doc_search, get_opcua_doc).

Define a second lightweight toolkit or resource set for best practices (e.g., opcua_howto_search or curated resources accessible via McpServer.resource).

✅ Checkpoint: Architecture doc capturing target endpoints, data sources, and user flows.

Phase 1 – Introduce OPC UA Domain Modules
Create a NodeSet loader layer

Under src/opcua/, add modules for downloading / reading XML (local cache + optional GitHub fetch mirroring current HTTP client setup).

Use Effect + Schema (or a typed parser) to decode NodeSet elements into ParsedUANode records.

Graph assembly

Store nodes in a map keyed by NodeId.

Materialize adjacency info (forward/inverse references grouped by ReferenceType) to support later enrichment.

✅ Checkpoint: Unit-level test (or manual log) proving one NodeSet parses into the typed structure with correct counts (objects, variables, references).

Phase 2 – Search Index Construction
Search text synthesis

Port the minisearch setup from ReferenceDocs.ts, but build the description text using:

BrowseName, DisplayName, Description.

NodeClass, DataType, Namespace metadata.

Parent/child browse paths assembled from the graph.

Reference summaries (HasComponent SerialNumber, etc.).

Document metadata

Extend each doc entry with richer frontmatter (namespace URI, NodeId, NodeClass) for detail rendering.

Detail renderer

Replace DocEntry.asMarkdown with a formatter that prints node metadata plus reference tables (forward & inverse) and optionally the raw XML snippet.

✅ Checkpoint: CLI script or test that performs a sample query (“SerialNumber”) and logs top results with expected metadata.

Phase 3 – MCP Toolkit Wiring
New toolkit layer

Rename / replace ReferenceDocsTools with OpcUaDocsTools.

Keep search + get_doc structure but swap schema names (opcua_doc_search, etc.).

Continue using Cache for detail retrieval; ensure pagination still works (page size tuned to longer node descriptions if needed).

Layer provisioning

Update main.ts to provide the new toolkit layer.

Confirm logging, HTTP, Markdown layers remain valid (Markdown still needed for how-to docs, not NodeSet content unless we render Markdown).

✅ Checkpoint: Local manual run of MCP server with opcua_doc_search verifying JSON schema + sample output.

Phase 4 – Best Practices / Guides Surface
Curated resource list

Extend Readmes.ts (or create BestPractices.ts) with OPC UA guide URLs (naming conventions, modeling rules, tutorials).

Add them as McpServer.resource entries or create a small minisearch index mirroring Phase 2 for queries against prose guides.

Differentiated access

Decide whether these appear as separate opcua_best_practice_search tool or simply as resources discoverable via McpServer.resource.

✅ Checkpoint: Confirm resources show up in MCP capabilities list and content loads via HTTP client.

Phase 5 – Cleanup & Communication
Remove Effect-specific assets

Delete or archive unused Effect doc code paths (old toolkit, schemas, README references).

Update documentation

Rewrite README.md to describe OPC UA focus, usage instructions, and available tools.

Update changelog to document the pivot.

✅ Checkpoint: Repository builds, lint/tests pass (if available), docs reviewed.

Phase 6 – Validation & Polishing
Spot-check graph awareness

Verify results for queries involving reference types (“HasSubtype PumpType”) return correct nodes with navigable parent/child context.

Performance & caching

Ensure NodeSet parsing happens once per run (layer-scoped) and large XML files don’t blow memory (consider streaming if necessary).

Future-proofing

Document how to add new NodeSets or update namespaces.

Outline ideas for later graph traversal tooling (e.g., follow-up tool to navigate references interactively).

✅ Checkpoint: Internal QA script covering success path, pagination, missing doc error handling.
