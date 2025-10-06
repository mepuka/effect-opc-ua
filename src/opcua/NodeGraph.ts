import { Effect, HashMap } from "effect"
import { ParsedUANode } from "./types.js"

export interface ReferenceGroup {
  readonly referenceType: string
  readonly targets: ReadonlyArray<string>
}

export interface NodeGraphEntry {
  readonly node: ParsedUANode
  readonly forwardReferences: ReadonlyArray<ReferenceGroup>
  readonly inverseReferences: ReadonlyArray<ReferenceGroup>
  readonly browsePath: string
}

export class NodeGraph extends Effect.Service<NodeGraph>()("NodeGraph", {
  scoped: Effect.gen(function* () {
    let nodeMap = HashMap.empty<string, NodeGraphEntry>()
    let initialized = false

    const buildGraph = Effect.fn("NodeGraph.buildGraph")(function* (
      nodes: ReadonlyArray<ParsedUANode>,
    ) {
      yield* Effect.logInfo(`Building node graph with ${nodes.length} nodes`)
      yield* Effect.annotateCurrentSpan({ nodeCount: nodes.length })

      // First pass: Create entries for all nodes
      const tempMap = new Map<string, NodeGraphEntry>()

      for (const node of nodes) {
        const nodeIdStr = node.nodeId.toString()

        // Group forward references by type
        const forwardRefMap = new Map<string, string[]>()
        for (const ref of node.references) {
          if (ref.isForward) {
            const targetId = ref.targetNodeId.toString()
            if (!forwardRefMap.has(ref.referenceType)) {
              forwardRefMap.set(ref.referenceType, [])
            }
            forwardRefMap.get(ref.referenceType)!.push(targetId)
          }
        }

        const forwardReferences = Array.from(forwardRefMap.entries()).map(
          ([referenceType, targets]) => ({
            referenceType,
            targets,
          }),
        )

        tempMap.set(nodeIdStr, {
          node,
          forwardReferences,
          inverseReferences: [],
          browsePath: node.browseName,
        })
      }

      // Second pass: Build inverse references
      for (const [nodeId, entry] of tempMap.entries()) {
        const inverseRefMap = new Map<string, string[]>()

        for (const node of nodes) {
          for (const ref of node.references) {
            if (ref.isForward && ref.targetNodeId.toString() === nodeId) {
              const sourceId = node.nodeId.toString()
              if (!inverseRefMap.has(ref.referenceType)) {
                inverseRefMap.set(ref.referenceType, [])
              }
              inverseRefMap.get(ref.referenceType)!.push(sourceId)
            }
          }
        }

        const inverseReferences = Array.from(inverseRefMap.entries()).map(
          ([referenceType, targets]) => ({
            referenceType,
            targets,
          }),
        )

        tempMap.set(nodeId, {
          ...entry,
          inverseReferences,
        })
      }

      // Third pass: Build browse paths (simplified - just parent/child)
      for (const [nodeId, entry] of tempMap.entries()) {
        let browsePath = entry.node.browseName

        // Find parent through HasComponent or Organizes references
        const parentRefs = entry.node.references.filter(
          (ref) =>
            !ref.isForward &&
            (ref.referenceType.includes("HasComponent") ||
              ref.referenceType.includes("Organizes") ||
              ref.referenceType.includes("HasProperty")),
        )

        if (parentRefs.length > 0) {
          const parentId = parentRefs[0].targetNodeId.toString()
          const parentEntry = tempMap.get(parentId)
          if (parentEntry) {
            browsePath = `${parentEntry.node.browseName}/${browsePath}`
          }
        }

        tempMap.set(nodeId, {
          ...entry,
          browsePath,
        })
      }

      // Convert to HashMap
      nodeMap = HashMap.fromIterable(tempMap.entries())
      initialized = true

      yield* Effect.logInfo(`Node graph built with ${tempMap.size} entries`)
      yield* Effect.annotateCurrentSpan({ graphSize: tempMap.size })
    })

    const getNode = (nodeId: string) =>
      Effect.sync(() => HashMap.get(nodeMap, nodeId))

    const getAllNodes = () =>
      Effect.sync(() => Array.from(HashMap.values(nodeMap)))

    const isInitialized = () => Effect.succeed(initialized)

    return {
      buildGraph,
      getNode,
      getAllNodes,
      isInitialized,
    } as const
  }),
}) {}
