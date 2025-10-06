# Effect OPC UA MCP Server (WIP)

This project provides an MCP server exposing tools and resources to explore official OPC UA NodeSets and curated OPC UA guides using Effect. It is intended for OPC UA members and implementers evaluating Effect-based workflows.

## What it does

- Exposes a semantic search tool over OPC UA NodeSets (Core + DI + selected companions) to retrieve nodes and their references as Markdown.
- Provides quick-links resources to official OPC UA specs and companion models.
- Runs as a CLI MCP server over stdio, suitable for IDE MCP clients (Cursor, Claude Code, etc.).

## Status

- Work-in-progress. Interfaces and outputs may change.

## Install & Run

- npx: `npx -y effect-opc-ua@latest`
- Local build: `pnpm build && node dist/main.cjs`

In Cursor, add to your `mcp.json`:

```json
"opcua-mcp": {
  "command": "npx",
  "args": ["-y", "effect-opc-ua@latest"]
}
```

## Available tools

- `opcua_doc_search(query: string)` → semantic search across loaded NodeSets.
- `get_opcua_doc(documentId: number, page?: number)` → retrieve Markdown for a result.

## Notes for members

- Sources: UA-Nodeset (Core, DI, selected companions).
- Results include forward/inverse references and browse paths for navigation.
- Contribution welcome; please open issues with model coverage requests.

## License

Apache-2.0
