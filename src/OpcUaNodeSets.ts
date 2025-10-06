import { Effect, Layer, Schema } from "effect"
import { McpServer, Tool, Toolkit } from "@effect/ai"
import { NodeSetCatalog } from "./opcua/NodeSetCatalog.js"
import { NodeSetCatalogEntry } from "./opcua/types.js"

const NodeSetListResult = Schema.Struct({
  entries: Schema.Array(NodeSetCatalogEntry),
})

const OpcUaNodeSetList = Tool.make("opcua_nodeset_list", {
  description:
    "Lists all available OPC UA NodeSet catalog entries with metadata and dependencies.",
  parameters: undefined,
  success: NodeSetListResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)

const toolkit = Toolkit.make(OpcUaNodeSetList)

const handlers = toolkit
  .toLayer(
    Effect.gen(function* () {
      const catalog = yield* NodeSetCatalog

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
      } as const
    }),
  )
  .pipe(Layer.provide(NodeSetCatalog.Default))

export const OpcUaNodeSetTools = McpServer.toolkit(toolkit).pipe(
  Layer.provideMerge(handlers),
)
