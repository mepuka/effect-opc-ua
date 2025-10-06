import { Effect, Schedule, Duration, Array, Data, Option } from "effect"
import { HttpClient } from "@effect/platform"
import { XMLParser } from "fast-xml-parser"
import { Schema } from "effect"
import {
  NodeId,
  ParsedUANode,
  Reference,
  LocalizedText,
  NamespaceMetadata,
  NodeSet,
  NodeClass,
} from "./types.js"

// URLs for OPC UA NodeSet XML files
const nodeSetUrls = [
  // Core OPC UA namespace
  "https://raw.githubusercontent.com/OPCFoundation/UA-Nodeset/latest/Schema/Opc.Ua.NodeSet2.xml",
  // Device Integration
  "https://raw.githubusercontent.com/OPCFoundation/UA-Nodeset/latest/DI/Opc.Ua.Di.NodeSet2.xml",
  // PackML
  "https://raw.githubusercontent.com/OPCFoundation/UA-Nodeset/latest/PackML/Opc.Ua.PackML.NodeSet2.xml",
]

const retryPolicy = Schedule.spaced(Duration.seconds(3))

class NodeSetLoaderError extends Data.TaggedError("NodeSetLoaderError")<{
  cause?: unknown
  message: string
}> {}

export class NodeSetLoader extends Effect.Service<NodeSetLoader>()(
  "NodeSetLoader",
  {
    scoped: Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient
      const retryingClient = client.pipe(
        HttpClient.filterStatusOk,
        HttpClient.retry(retryPolicy),
      )

      const xmlParser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        textNodeName: "#text",
        parseAttributeValue: true,
      })

      const parseNodeId = (nodeIdStr: string): NodeId => {
        const parts = nodeIdStr.split(";")
        let namespaceIndex = 0
        let identifierType: "Numeric" | "String" | "Guid" | "Opaque" = "Numeric"
        let identifier = ""

        for (const part of parts) {
          if (part.startsWith("ns=")) {
            namespaceIndex = parseInt(part.substring(3), 10)
          } else if (part.startsWith("i=")) {
            identifierType = "Numeric"
            identifier = part.substring(2)
          } else if (part.startsWith("s=")) {
            identifierType = "String"
            identifier = part.substring(2)
          } else if (part.startsWith("g=")) {
            identifierType = "Guid"
            identifier = part.substring(2)
          } else if (part.startsWith("b=")) {
            identifierType = "Opaque"
            identifier = part.substring(2)
          }
        }

        return new NodeId({ namespaceIndex, identifierType, identifier })
      }

      const parseLocalizedText = (text: any): LocalizedText | undefined => {
        if (!text) return undefined
        if (typeof text === "string") {
          return new LocalizedText({ text })
        }
        return new LocalizedText({
          locale: text?.["@_Locale"],
          text: text?.["#text"] || text || "",
        })
      }

      const parseReferences = (refs: any): Reference[] => {
        if (!refs || !refs.Reference) return []
        const refArray = Array.isArray(refs.Reference)
          ? refs.Reference
          : [refs.Reference]
        return refArray.map(
          (ref: any) =>
            new Reference({
              referenceType: ref["@_ReferenceType"] || "References",
              isForward: ref["@_IsForward"] !== false,
              targetNodeId: parseNodeId(ref["#text"] || ref),
            }),
        )
      }

      const getNodeClass = (tagName: string): NodeClass => {
        if (tagName.includes("Object")) return "Object"
        if (tagName.includes("Variable")) return "Variable"
        if (tagName.includes("Method")) return "Method"
        if (tagName.includes("ObjectType")) return "ObjectType"
        if (tagName.includes("VariableType")) return "VariableType"
        if (tagName.includes("ReferenceType")) return "ReferenceType"
        if (tagName.includes("DataType")) return "DataType"
        if (tagName.includes("View")) return "View"
        return "Object"
      }

      const parseNode = (nodeData: any, tagName: string): ParsedUANode => {
        const nodeClass = getNodeClass(tagName)
        const displayName =
          parseLocalizedText(nodeData.DisplayName) ||
          new LocalizedText({ text: nodeData["@_BrowseName"] || "" })
        const description =
          nodeData.Description !== undefined
            ? parseLocalizedText(nodeData.Description)
            : undefined

        return new ParsedUANode({
          nodeId: parseNodeId(nodeData["@_NodeId"]),
          nodeClass,
          browseName: nodeData["@_BrowseName"] || "",
          displayName,
          description: description ? Option.some(description) : Option.none(),
          references: parseReferences(nodeData.References),
          dataType: nodeData["@_DataType"],
          valueRank: nodeData["@_ValueRank"],
          isAbstract: nodeData["@_IsAbstract"],
          symmetric: nodeData["@_Symmetric"],
        })
      }

      const parseNodeSetXml = (xmlContent: string): NodeSet => {
        const parsed = xmlParser.parse(xmlContent)
        const nodeSet = parsed.UANodeSet || parsed

        // Parse namespace URIs
        const namespaces: NamespaceMetadata[] = []
        const nsUris = nodeSet.NamespaceUris?.Uri
        if (nsUris) {
          const uriArray = Array.isArray(nsUris) ? nsUris : [nsUris]
          uriArray.forEach((uri: string) => {
            namespaces.push(
              new NamespaceMetadata({
                uri,
                publicationDate: nodeSet["@_PublicationDate"],
                version: nodeSet["@_Version"],
              }),
            )
          })
        }

        // Parse nodes
        const nodes: ParsedUANode[] = []
        const nodeTypes = [
          "UAObject",
          "UAVariable",
          "UAMethod",
          "UAObjectType",
          "UAVariableType",
          "UAReferenceType",
          "UADataType",
          "UAView",
        ]

        for (const nodeType of nodeTypes) {
          const nodeData = nodeSet[nodeType]
          if (nodeData) {
            const nodeArray = Array.isArray(nodeData) ? nodeData : [nodeData]
            for (const node of nodeArray) {
              nodes.push(parseNode(node, nodeType))
            }
          }
        }

        return new NodeSet({ namespaces, nodes })
      }

      const loadNodeSet = Effect.fn("NodeSetLoader.loadNodeSet")(function* (
        url: string,
      ) {
        yield* Effect.logInfo(`Loading NodeSet from ${url}`)
        yield* Effect.annotateCurrentSpan({ url })

        const response = yield* retryingClient
          .get(url)
          .pipe(
            Effect.tapErrorCause((cause) =>
              Effect.logError(`HTTP request failed for ${url}`, cause),
            ),
          )

        const xmlContent = yield* response.text

        const nodeSet = yield* Effect.try({
          try: () => parseNodeSetXml(xmlContent),
          catch: (cause) =>
            new NodeSetLoaderError({
              cause,
              message: `Failed to parse NodeSet XML from ${url}`,
            }),
        }).pipe(
          Effect.tapErrorCause((cause) =>
            Effect.logError(`XML parsing failed for ${url}`, cause),
          ),
        )

        yield* Effect.logInfo(
          `Loaded ${nodeSet.nodes.length} nodes from ${url}`,
        )
        yield* Effect.annotateCurrentSpan({ nodeCount: nodeSet.nodes.length })

        return nodeSet
      })

      const loadAllNodeSets = Effect.fn("NodeSetLoader.loadAllNodeSets")(
        function* () {
          yield* Effect.logInfo(
            `Loading ${nodeSetUrls.length} NodeSet files concurrently`,
          )
          yield* Effect.annotateCurrentSpan({
            nodeSetCount: nodeSetUrls.length,
          })

          const nodeSets = yield* Effect.forEach(
            nodeSetUrls,
            (url) => loadNodeSet(url),
            { concurrency: 2 },
          ).pipe(
            Effect.tapErrorCause((cause) =>
              Effect.logError("Failed to load all NodeSets", cause),
            ),
          )

          // Merge all node sets
          const allNamespaces = nodeSets.flatMap((ns) => ns.namespaces)
          const allNodes = nodeSets.flatMap((ns) => ns.nodes)

          yield* Effect.logInfo(
            `Loaded total of ${allNodes.length} nodes from ${nodeSetUrls.length} NodeSets`,
          )
          yield* Effect.annotateCurrentSpan({ totalNodes: allNodes.length })

          return new NodeSet({
            namespaces: allNamespaces,
            nodes: allNodes,
          })
        },
      )

      return { loadNodeSet, loadAllNodeSets } as const
    }),
  },
) {}
