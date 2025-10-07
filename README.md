# Effect OPC UA MCP Server

**WIP - Work in Progress. Needs optimization.**

MCP server for OPC UA NodeSet exploration using Effect. Provides semantic search over OPC UA information models and static guides.

## Current Functionality

**Tools:**

- `opcua_doc_search(query)` - Search OPC UA NodeSets (Core, DI, PackML, ADI, AutoID, Machinery, Robotics)
- `get_opcua_doc(documentId, page?)` - Retrieve node documentation as Markdown
- `opcua_nodeset_list()` - List available NodeSet catalog entries

**Resources:**

- OPC UA guides and best practices (static content)

## Installation

```bash
npx -y opc-ua-mcp@latest
```

**Cursor MCP config:**

```json
{
  "opcua-mcp": {
    "command": "npx",
    "args": ["-y", "opc-ua-mcp@latest"]
  }
}
```

## Status & Limitations

- **WIP**: Interfaces may change
- **Performance**: Initial load time slow due to NodeSet parsing and indexing
- **Memory**: High memory usage during startup
- **Coverage**: Limited to subset of companion specifications
- **Optimization needed**: Caching, lazy loading, and performance improvements required

## License

Apache-2.0
