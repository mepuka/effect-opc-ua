import { Cache, Duration, Effect, Layer, Option, Schema, Array } from "effect"
import { McpServer, Tool, Toolkit } from "@effect/ai"
import Minisearch from "minisearch"
import { NodeSetLoader } from "./opcua/NodeSetLoader.js"
import { NodeGraph, NodeGraphEntry } from "./opcua/NodeGraph.js"
import {
  NodeDocumentEntry,
  ParsedUANode,
  LocalizedText,
} from "./opcua/types.js"

const documentId = Schema.Number.pipe(
  Schema.annotations({
    description: "The unique identifier for the OPC UA documentation entry.",
  }),
)

const SearchResult = Schema.Struct({
  documentId,
  title: Schema.String,
  description: Schema.optional(Schema.String),
})

const OpcUaDocSearch = Tool.make("opcua_doc_search", {
  description:
    "Searches the OPC UA NodeSet documentation. Result content can be accessed with the `get_opcua_doc` tool.",
  parameters: {
    query: Schema.String.pipe(
      Schema.annotations({
        description: "The search query to look for in the documentation.",
      }),
    ),
  },
  success: Schema.Struct({
    results: Schema.Array(SearchResult),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)

const GetOpcUaDoc = Tool.make("get_opcua_doc", {
  description:
    "Get the OPC UA documentation for a documentId. The content might be paginated. Use the `page` parameter to specify which page to retrieve.",
  parameters: {
    documentId,
    page: Schema.optional(
      Schema.Number.pipe(
        Schema.annotations({
          description: "The page number to retrieve (defaults to 1)",
        }),
      ),
    ),
  },
  success: Schema.Struct({
    content: Schema.String,
    page: Schema.Number,
    totalPages: Schema.Number,
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)

const toolkit = Toolkit.make(OpcUaDocSearch, GetOpcUaDoc)

const renderNodeAsMarkdown = (
  entry: NodeGraphEntry,
  node: ParsedUANode,
): string => {
  let markdown = `# ${node.browseName}\n\n`

  markdown += `**NodeClass:** ${node.nodeClass}\n`
  markdown += `**NodeId:** ${node.nodeId.toString()}\n`
  markdown += `**Browse Path:** ${entry.browsePath}\n\n`

  // Display name
  markdown += `**Display Name:** ${node.displayName.text}\n\n`

  // Description
  Option.match(node.description, {
    onNone: () => {},
    onSome: (desc: LocalizedText) => {
      markdown += `**Description:**\n${desc.text}\n\n`
    },
  })

  // Type-specific information
  if (node.dataType) {
    markdown += `**Data Type:** ${node.dataType}\n`
  }
  if (node.valueRank !== undefined) {
    markdown += `**Value Rank:** ${node.valueRank}\n`
  }
  if (node.isAbstract !== undefined) {
    markdown += `**Is Abstract:** ${node.isAbstract}\n`
  }
  if (node.symmetric !== undefined) {
    markdown += `**Symmetric:** ${node.symmetric}\n`
  }

  // Forward references
  if (entry.forwardReferences.length > 0) {
    markdown += `\n## Forward References\n\n`
    for (const refGroup of entry.forwardReferences) {
      markdown += `### ${refGroup.referenceType}\n`
      for (const targetId of refGroup.targets) {
        markdown += `- ${targetId}\n`
      }
      markdown += `\n`
    }
  }

  // Inverse references
  if (entry.inverseReferences.length > 0) {
    markdown += `\n## Inverse References\n\n`
    for (const refGroup of entry.inverseReferences) {
      markdown += `### ${refGroup.referenceType}\n`
      for (const sourceId of refGroup.targets) {
        markdown += `- ${sourceId}\n`
      }
      markdown += `\n`
    }
  }

  return markdown
}

// Handler Layer - provides the implementation for the tools
const ToolkitHandlers = toolkit
  .toLayer(
    Effect.gen(function* () {
      const loader = yield* NodeSetLoader
      const graph = yield* NodeGraph

      // Load all NodeSets
      const nodeSet = yield* loader.loadAllNodeSets()

      // Build the graph
      yield* graph.buildGraph(nodeSet.nodes)

      // Build search index
      const docs = Array.empty<NodeDocumentEntry>()
      const minisearch = new Minisearch<NodeDocumentEntry>({
        fields: ["title", "description", "nodeClass", "browsePath"],
        searchOptions: {
          boost: { title: 3, browsePath: 2 },
          fuzzy: 0.2,
        },
        storeFields: [
          "nodeId",
          "title",
          "description",
          "nodeClass",
          "namespace",
        ],
      })

      const allNodes = yield* graph.getAllNodes()

      yield* Effect.logInfo(`Indexing ${allNodes.length} nodes for search`)

      for (const graphEntry of allNodes) {
        const node = graphEntry.node
        const description = Option.match(node.description, {
          onNone: () => undefined,
          onSome: (desc: LocalizedText) => desc.text,
        })

        // Build search text with graph context
        const forwardRefSummary = graphEntry.forwardReferences
          .map(
            (ref) =>
              `${ref.referenceType}: ${ref.targets.slice(0, 3).join(", ")}`,
          )
          .join(" | ")

        const searchDescription = [
          description,
          `Browse Path: ${graphEntry.browsePath}`,
          forwardRefSummary,
        ]
          .filter(Boolean)
          .join(" | ")

        const entry: NodeDocumentEntry = {
          id: docs.length,
          nodeId: node.nodeId.toString(),
          title: `${node.browseName} (${node.nodeClass})`,
          description: searchDescription,
          nodeClass: node.nodeClass,
          namespace: node.namespaceUri,
          node,
        }

        docs.push(entry)
        minisearch.add(entry as any)
      }

      yield* Effect.logInfo(`Indexed ${docs.length} nodes`)

      const search = (query: string) =>
        Effect.sync(() =>
          minisearch
            .search(query)
            .slice(0, 50)
            .map((result) => docs[result.id]),
        )

      const cache = yield* Cache.make({
        lookup: (id: number) =>
          Effect.gen(function* () {
            const doc = docs[id]
            const graphEntry = yield* graph.getNode(doc.nodeId)

            return Option.match(graphEntry, {
              onNone: () => `# ${doc.title}\n\nNode not found in graph.`,
              onSome: (entry) => renderNodeAsMarkdown(entry, doc.node),
            })
          }),
        capacity: 512,
        timeToLive: Duration.hours(12),
      })

      // Return the handlers
      return {
        opcua_doc_search: ({ query }) =>
          Effect.gen(function* () {
            const results = yield* search(query)
            return {
              results: results.map((result) => ({
                documentId: result.id,
                title: result.title,
                description: result.description,
              })),
            }
          }).pipe(
            Effect.withSpan("opcua_doc_search", { attributes: { query } }),
            Effect.tapErrorCause((cause) =>
              Effect.logError("Search failed", cause),
            ),
          ),

        get_opcua_doc: ({ documentId, page }) =>
          Effect.gen(function* () {
            const pageNum: number = page ?? 1
            const pageSize = 1000
            const content = yield* cache.get(documentId)
            const lines = content.split("\n")
            const pages = Math.ceil(lines.length / pageSize)
            const offset = (pageNum - 1) * pageSize
            return {
              content: lines.slice(offset, offset + pageSize).join("\n"),
              page: pageNum as number,
              totalPages: pages,
            }
          }).pipe(
            Effect.withSpan("get_opcua_doc", {
              attributes: { documentId, page: page ?? 1 },
            }),
            Effect.tapErrorCause((cause) =>
              Effect.logError("Document retrieval failed", cause),
            ),
          ),
      } as const
    }),
  )
  .pipe(Layer.provide([NodeSetLoader.Default, NodeGraph.Default]))

// Register the toolkit with the MCP server
export const OpcUaDocsTools = McpServer.toolkit(toolkit).pipe(
  Layer.provideMerge(ToolkitHandlers),
)
