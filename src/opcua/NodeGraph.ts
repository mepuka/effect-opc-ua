import { Effect, HashMap, Option, Ref } from "effect"
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
    const nodeMapRef = yield* Ref.make(HashMap.empty<string, NodeGraphEntry>())
    const initializedRef = yield* Ref.make(false)

    const buildGraph = Effect.fn("NodeGraph.buildGraph")(function* (
      nodes: ReadonlyArray<ParsedUANode>,
    ) {
      yield* Effect.logInfo(`Building node graph with ${nodes.length} nodes`)
      yield* Effect.annotateCurrentSpan({ nodeCount: nodes.length })

      let forwardGroups =
        HashMap.empty<string, HashMap.HashMap<string, ReadonlyArray<string>>>()
      let inverseGroups =
        HashMap.empty<string, HashMap.HashMap<string, ReadonlyArray<string>>>()

      for (const node of nodes) {
        const nodeId = node.nodeId.toString()

        let nodeForward = Option.getOrElse(
          HashMap.get(forwardGroups, nodeId),
          () => HashMap.empty<string, ReadonlyArray<string>>(),
        )

        for (const ref of node.references) {
          if (!ref.isForward) {
            continue
          }

          const targetId = ref.targetNodeId.toString()

          const currentForwardTargets = Option.getOrElse(
            HashMap.get(nodeForward, ref.referenceType),
            () => [] as ReadonlyArray<string>,
          )

          nodeForward = HashMap.set(nodeForward, ref.referenceType, [
            ...currentForwardTargets,
            targetId,
          ])

          const currentInverseMap = Option.getOrElse(
            HashMap.get(inverseGroups, targetId),
            () => HashMap.empty<string, ReadonlyArray<string>>(),
          )

          const currentInverseTargets = Option.getOrElse(
            HashMap.get(currentInverseMap, ref.referenceType),
            () => [] as ReadonlyArray<string>,
          )

          const updatedInverseMap = HashMap.set(
            currentInverseMap,
            ref.referenceType,
            [...currentInverseTargets, nodeId],
          )

          inverseGroups = HashMap.set(inverseGroups, targetId, updatedInverseMap)
        }

        forwardGroups = HashMap.set(forwardGroups, nodeId, nodeForward)
      }

      let graphMap = HashMap.empty<string, NodeGraphEntry>()

      for (const node of nodes) {
        const nodeId = node.nodeId.toString()
        const forwardMap = Option.getOrElse(
          HashMap.get(forwardGroups, nodeId),
          () => HashMap.empty<string, ReadonlyArray<string>>(),
        )

        const forwardReferences = Array.from(HashMap.entries(forwardMap)).map(
          ([referenceType, targets]) => ({
            referenceType,
            targets,
          }),
        )

        graphMap = HashMap.set(graphMap, nodeId, {
          node,
          forwardReferences,
          inverseReferences: [],
          browsePath: node.browseName,
        })
      }

      for (const node of nodes) {
        const nodeId = node.nodeId.toString()
        const entry = HashMap.get(graphMap, nodeId)
        if (Option.isNone(entry)) {
          continue
        }

        const inverseMap = Option.getOrElse(
          HashMap.get(inverseGroups, nodeId),
          () => HashMap.empty<string, ReadonlyArray<string>>(),
        )

        const inverseReferences = Array.from(HashMap.entries(inverseMap)).map(
          ([referenceType, targets]) => ({
            referenceType,
            targets,
          }),
        )

        let browsePath = entry.value.node.browseName
        const parentRefs = entry.value.node.references.filter(
          (ref) =>
            !ref.isForward &&
            (ref.referenceType.includes("HasComponent") ||
              ref.referenceType.includes("Organizes") ||
              ref.referenceType.includes("HasProperty")),
        )

        if (parentRefs.length > 0) {
          const parentId = parentRefs[0].targetNodeId.toString()
          const parentEntry = HashMap.get(graphMap, parentId)
          if (Option.isSome(parentEntry)) {
            browsePath = `${parentEntry.value.browsePath}/${browsePath}`
          }
        }

        graphMap = HashMap.set(graphMap, nodeId, {
          ...entry.value,
          inverseReferences,
          browsePath,
        })
      }

      yield* Ref.set(nodeMapRef, graphMap)
      yield* Ref.set(initializedRef, true)

      yield* Effect.logInfo(
        `Node graph built with ${HashMap.size(graphMap)} entries`,
      )
      yield* Effect.annotateCurrentSpan({ graphSize: HashMap.size(graphMap) })
    })

    const getNode = (nodeId: string) =>
      Effect.gen(function* () {
        const map = yield* Ref.get(nodeMapRef)
        return HashMap.get(map, nodeId)
      })

    const getAllNodes = () =>
      Effect.gen(function* () {
        const map = yield* Ref.get(nodeMapRef)
        return Array.from(HashMap.values(map))
      })

    const isInitialized = () => Ref.get(initializedRef)

    return {
      buildGraph,
      getNode,
      getAllNodes,
      isInitialized,
    } as const
  }),
}) {}
