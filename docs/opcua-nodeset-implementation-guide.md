# OPC UA NodeSet Catalog & Dynamic Loading Implementation Guide

This document synthesizes the existing OPC UA MCP server architecture with Effect-first design guidance to implement a catalog-driven NodeSet workflow. It consolidates earlier planning passes, reinforces idiomatic Effect patterns from official resources, and lays out actionable milestones for introducing companion specification management.

## 1. Current Architecture Snapshot

### NodeSet ingestion
- `NodeSetLoader` now resolves `NodeSetCatalog` entries (Core, DI, PackML, and additional companion specs) and exposes `loadNodeSet`, `loadNodeSets`, `loadNodeSetBySlug`, and `loadDefaultNodeSets`, reusing an Undici-backed HTTP client, XML parsing via `fast-xml-parser`, and Effect retry scheduling.【F:src/opcua/NodeSetLoader.ts†L1-L205】【F:src/opcua/NodeSetCatalog.ts†L1-L167】
- Parsing returns immutable `NodeSet` and `ParsedUANode` records with localized text, reference lists, namespace metadata, and catalog-derived context such as namespace URIs.【F:src/opcua/NodeSetLoader.ts†L68-L162】【F:src/opcua/types.ts†L1-L105】

### Graph materialization
- `NodeGraph` builds a HashMap-backed graph for forward/inverse references and browse paths during startup and exposes `buildGraph`, `getNode`, and `getAllNodes`. State is stored in module-level `let` bindings, which is safe for the one-shot initialization but will need synchronization when updates become incremental.【F:src/opcua/NodeGraph.ts†L1-L88】

### Search & MCP surface
- `OpcUaDocs` loads the catalog defaults during layer initialization, builds a Minisearch index, and registers two tools (`opcua_doc_search`, `get_opcua_doc`). Document rendering pulls graph context from the cache to emit Markdown with reference tables.【F:src/OpcUaDocs.ts†L1-L211】【F:src/OpcUaDocs.ts†L211-L271】
- `main.ts` wires the docs toolkit and a static set of guide resources into the MCP server alongside logging and the Node HTTP client.【F:src/main.ts†L1-L21】

## 2. Effect-Native Design Considerations

Leverage idioms highlighted across the [Effect docs](https://effect.website/docs), the Effect TS documentation portal, and Paul J. Philp’s [Effect Patterns](https://github.com/PaulJPhilp/EffectPatterns):

1. **Service layering** – Model the NodeSet catalog, loader, graph, and index as separate `Effect.Service` instances so responsibilities remain composable and testable. This mirrors how the loader and graph are already registered today.【F:src/opcua/NodeSetLoader.ts†L33-L242】【F:src/opcua/NodeGraph.ts†L15-L88】
2. **`Effect.fn` for traced operations** – Continue wrapping side-effecting helpers (`loadNodeSet`, `buildGraph`, future `addNodeSet`) with `Effect.fn` to get spans, log annotations, and typed error channels without manual `try/catch`.
3. **State via `Ref` / `SynchronizedRef`** – Replace module-level mutability in `NodeGraph` and the upcoming index service with Effect-managed refs to ensure concurrency safety when multiple tool invocations mutate shared structures.
4. **Scoped resource management** – Use `Effect.scoped`/`Layer.scoped` and `Cache.make` for caches and memoized fetches so cleanup is deterministic and consistent with Effect runtime expectations.
5. **Declarative error handling** – Continue using `Effect.try`, `Effect.tapErrorCause`, and typed error constructors for XML parsing / HTTP fetch failures; extend this approach when catalog lookups fail so user-facing tools produce structured error responses.

## 3. Roadmap for Catalog-Driven NodeSet Management

### Phase A – Catalog service foundation
1. Create `NodeSetCatalog` with immutable metadata for all supported NodeSets (core defaults + companion specs such as CAS, ADI, AutoID). Provide `list`, `search`, and `resolve` APIs returning catalog entries keyed by slug.
2. Seed the service with entries representing the existing hard-coded URLs to preserve current behavior, then append new specs from the UA-Nodeset repository. Consider following the directory layout in the upstream repo when defining slugs (e.g., `CAS`, `ADI`).
3. Optional: add an Effect-based GitHub directory fetcher later, but start with manually curated metadata to keep scope manageable.

### Phase B – Loader generalization
1. Refactor `NodeSetLoader` so `loadNodeSet` accepts a catalog entry (including display name, namespace URIs, dependencies). Reuse the existing retrying HTTP client and XML parser but annotate spans/logs with catalog metadata.
2. Replace the `nodeSetUrls` array with a `loadDefaultNodeSets` helper that pulls the startup preload list from the catalog service. Provide a memoized cache (e.g., `Cache.make`) keyed by catalog slug to reuse loaded NodeSets across tool invocations.

### Phase C – Mutable graph & index services
1. Move `NodeGraph`’s internal state into a `SynchronizedRef<HashMap<...>>`, exposing `buildGraph` (full rebuild) and `addNodeSet` (incremental merge) operations. Ensure inverse reference computation and browse path derivation run within the ref update to avoid race conditions.
2. Extract search index responsibilities into `NodeSearchIndex` that owns the Minisearch instance and document list. Provide `buildIndex` for bulk initialization and `addDocuments` for incremental updates. Use `Effect.fn` and `SynchronizedRef` to gate writes.
3. Update `OpcUaDocs` to depend on both services, calling `buildGraph`/`buildIndex` during layer initialization with the default preload set.

### Phase D – MCP toolkit for catalog operations
1. Introduce `OpcUaNodeSetTools` (or similar) exposing:
   - `opcua_nodeset_list` – returns catalog entries for discovery.
   - `opcua_nodeset_search` – fuzzy match catalog names/tags.
   - `load_opcua_nodeset` – resolves a slug, loads the XML via the loader, pushes nodes into the graph/index services, and responds with counts & namespaces.
2. Ensure `load_opcua_nodeset` runs catalog lookup, loading, and index updates within a single Effect pipeline so logs/spans correlate across services.
3. Register the new toolkit alongside docs/guides in `main.ts`, sharing the same service layers so newly loaded NodeSets are instantly searchable through the existing tools.

### Phase E – Documentation & validation
1. Update `README.md` to describe the catalog workflow, default preload set, and how to pull additional NodeSets dynamically.
2. Add smoke scripts or tests that call the new tools sequentially (list → load CAS → search for CAS node) to verify incremental updates.
3. Document future enhancements, including GitHub catalog synchronization, dependency-aware loading, and richer graph traversal tools.

## 4. Implementation Tips & Patterns

- **Minimize blocking operations**: Favor `Effect.forEach` with controlled concurrency when downloading or indexing multiple NodeSets; the current loader already uses `concurrency: 2`, which can be parameterized for catalog-driven batches.【F:src/opcua/NodeSetLoader.ts†L214-L233】
- **Encapsulate formatting**: Keep Markdown rendering focused on display concerns; when adding catalog metadata (namespace URI, publication date), compute them in the cache lookup effect before rendering.
- **Emit informative telemetry**: Continue annotating spans and logs with node counts, catalog slugs, and namespace info to aid observability during large loads.
- **Leverage guides toolkit**: The existing guide resources demonstrate how to expose static references. Mirror this style for curated documentation about catalog usage or modeling best practices if needed.【F:src/OpcUaGuides.ts†L1-L87】

## 5. Resource Pointers

- Effect documentation portal: <https://effect.website/docs>
- Effect TS Docs: <https://effect-ts.github.io/effect/docs/effect>
- Paul J. Philp’s Effect Patterns collection: <https://github.com/PaulJPhilp/EffectPatterns>

Refer back to these resources for additional patterns such as service layering, ref-based state management, and testing strategies when implementing the catalog and dynamic loading capabilities.
