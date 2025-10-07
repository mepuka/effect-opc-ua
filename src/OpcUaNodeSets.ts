import { Effect, Layer, Schema } from "effect"
import { McpServer, Tool, Toolkit } from "@effect/ai"
import { NodeSetCatalog } from "./opcua/NodeSetCatalog.js"
import { NodeSetLoader } from "./opcua/NodeSetLoader.js"
import { NodeSetCatalogEntry } from "./opcua/types.js"

const NodeSetListResult = Schema.Struct({
  entries: Schema.Array(NodeSetCatalogEntry),
})

const NodeSetIngestFields = {
  url: Schema.String,
  slug: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  category: Schema.optional(Schema.String),
  documentationUrl: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  namespaceUris: Schema.optional(Schema.Array(Schema.String)),
  dependencies: Schema.optional(Schema.Array(Schema.String)),
  defaultSelection: Schema.optional(Schema.Boolean),
} as const

const NodeSetIngestParameters = Schema.Struct(NodeSetIngestFields)
const NodeSetIngestResult = Schema.Struct({
  entry: NodeSetCatalogEntry,
  nodeCount: Schema.Number,
})
const NodeSetIngestFailure = Schema.Struct({
  message: Schema.String,
})

type NodeSetIngestInput = Schema.Schema.Type<typeof NodeSetIngestParameters>

const OpcUaNodeSetList = Tool.make("opcua_nodeset_list", {
  description:
    "Lists all available OPC UA NodeSet catalog entries with metadata and dependencies.",
  parameters: undefined,
  success: NodeSetListResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)

const OpcUaNodeSetIngest = Tool.make("opcua_nodeset_ingest", {
  description:
    "Downloads and ingests a new OPC UA NodeSet into the catalog and persistent cache.",
  parameters: NodeSetIngestFields,
  success: NodeSetIngestResult,
  failure: NodeSetIngestFailure,
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)

const toolkit = Toolkit.make(OpcUaNodeSetList, OpcUaNodeSetIngest)

const handlers = toolkit
  .toLayer(
    Effect.gen(function* () {
      const catalog = yield* NodeSetCatalog
      const loader = yield* NodeSetLoader

      return {
        opcua_nodeset_list: () =>
          Effect.gen(function* () {
            const entries = yield* catalog.list()
            return { entries }
          }).pipe(
            Effect.withSpan("opcua_nodeset_list"),
            Effect.tapErrorCause((cause) =>
              Effect.logError("Listing NodeSet catalog failed", cause),
            ),
          ),
        opcua_nodeset_ingest: (params: NodeSetIngestInput) =>
          Effect.gen(function* () {
            const { entry, nodeSet } = yield* loader.ingestNodeSet(params)

            yield* Effect.logInfo(
              `Ingested NodeSet ${entry.slug} from ${params.url}`,
            )

            return {
              entry,
              nodeCount: nodeSet.nodes.length,
            }
          }).pipe(
            Effect.withSpan("opcua_nodeset_ingest", {
              attributes: { slug: params.slug ?? "generated", url: params.url },
            }),
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                const message =
                  error instanceof Error
                    ? error.message
                    : typeof error === "string"
                      ? error
                      : "NodeSet ingestion failed"

                yield* Effect.logError("NodeSet ingestion failed", error)

                return yield* Effect.fail({ message })
              }),
            ),
          ),
      } as const
    }),
  )
  .pipe(Layer.provide([NodeSetCatalog.Default, NodeSetLoader.Default]))

export const OpcUaNodeSetTools = McpServer.toolkit(toolkit).pipe(
  Layer.provideMerge(handlers),
)
