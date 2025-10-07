import { Cache, Data, Duration, Effect, Option, Schedule } from "effect"
import { HttpClient, HttpClientRequest, KeyValueStore } from "@effect/platform"
import { NodeHttpClient } from "@effect/platform-node"
import { XMLParser } from "fast-xml-parser"
import {
  LocalizedText,
  NamespaceMetadata,
  NodeClass,
  NodeId,
  NodeSet,
  NodeSetCatalogEntry,
  ParsedUANode,
  Reference,
} from "./types.js"
import { NodeSetCatalog, NodeSetCatalogNotFound } from "./NodeSetCatalog.js"

const retryPolicy = Schedule.spaced(Duration.seconds(3))

export class NodeSetLoaderError extends Data.TaggedError("NodeSetLoaderError")<{
  readonly cause?: unknown
  readonly message: string
}> {}

const mergeNodeSets = (nodeSets: ReadonlyArray<NodeSet>): NodeSet =>
  new NodeSet({
    namespaces: nodeSets.flatMap((ns) => ns.namespaces),
    nodes: nodeSets.flatMap((ns) => ns.nodes),
  })

const cacheKey = (slug: string): string => `nodesets/${slug}`

export class NodeSetLoaderSource extends Effect.Service<NodeSetLoaderSource>()(
  "NodeSetLoaderSource",
  {
    scoped: Effect.gen(function* () {
      const catalog = yield* NodeSetCatalog
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.filterStatusOk,
        HttpClient.retry(retryPolicy),
        HttpClient.mapRequest(
          HttpClientRequest.setHeaders({
            Accept: "application/xml",
            "User-Agent": "https://github.com/opcua-org/node-opcua",
          }),
        ),
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
            namespaceIndex = Number.parseInt(part.substring(3), 10)
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
        if (tagName.includes("ObjectType")) return "ObjectType"
        if (tagName.includes("VariableType")) return "VariableType"
        if (tagName.includes("ReferenceType")) return "ReferenceType"
        if (tagName.includes("DataType")) return "DataType"
        if (tagName.includes("Method")) return "Method"
        if (tagName.includes("Variable")) return "Variable"
        if (tagName.includes("View")) return "View"
        return "Object"
      }

      const parseNode = (
        nodeData: any,
        tagName: string,
        resolveNamespaceUri: (index: number) => string | undefined,
      ): ParsedUANode => {
        const nodeClass = getNodeClass(tagName)
        const displayName =
          parseLocalizedText(nodeData.DisplayName) ||
          new LocalizedText({ text: nodeData["@_BrowseName"] || "" })
        const description =
          nodeData.Description !== undefined
            ? parseLocalizedText(nodeData.Description)
            : undefined

        const nodeId = parseNodeId(nodeData["@_NodeId"])
        const namespaceUri = resolveNamespaceUri(nodeId.namespaceIndex)

        return new ParsedUANode({
          nodeId,
          nodeClass,
          browseName: nodeData["@_BrowseName"] || "",
          displayName,
          description: description ? Option.some(description) : Option.none(),
          references: parseReferences(nodeData.References),
          namespaceUri: namespaceUri ?? undefined,
          dataType: nodeData["@_DataType"],
          valueRank: nodeData["@_ValueRank"],
          isAbstract: nodeData["@_IsAbstract"],
          symmetric: nodeData["@_Symmetric"],
        })
      }

      const parseNodeSetXml = (
        xmlContent: string,
        entry: NodeSetCatalogEntry,
      ): NodeSet => {
        const parsed = xmlParser.parse(xmlContent)
        const nodeSet = parsed.UANodeSet || parsed

        const publicationDate = nodeSet["@_PublicationDate"]
        const version = nodeSet["@_Version"]

        const namespaces: NamespaceMetadata[] = []
        const namespaceLookup: string[] = []

        const registerNamespace = (uri: string | undefined, index: number) => {
          if (!uri) return
          namespaceLookup[index] = uri
          if (!namespaces.some((ns) => ns.uri === uri)) {
            namespaces.push(
              new NamespaceMetadata({
                uri,
                publicationDate,
                version,
              }),
            )
          }
        }

        if (entry.namespaceUris.length > 0) {
          registerNamespace(entry.namespaceUris[0], 0)
        }

        const nsUris = nodeSet.NamespaceUris?.Uri
        if (nsUris) {
          const uriArray = Array.isArray(nsUris) ? nsUris : [nsUris]
          uriArray.forEach((uri: string, index: number) => {
            registerNamespace(uri, index + 1)
          })
        }

        entry.namespaceUris.forEach((uri, index) => {
          if (!namespaceLookup[index]) {
            registerNamespace(uri, index)
          }
        })

        const resolveNamespaceUri = (namespaceIndex: number) =>
          namespaceLookup[namespaceIndex] ??
          entry.namespaceUris[namespaceIndex] ??
          entry.namespaceUris[0]

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
              nodes.push(parseNode(node, nodeType, resolveNamespaceUri))
            }
          }
        }

        return new NodeSet({ namespaces, nodes })
      }

      const fetchNodeSet = Effect.fn("NodeSetLoaderSource.fetchNodeSet")(
        function* (entry: NodeSetCatalogEntry) {
          yield* Effect.logInfo(
            `Loading NodeSet ${entry.name} (${entry.slug}) from ${entry.nodeSetUrl}`,
          )
          yield* Effect.annotateCurrentSpan({
            slug: entry.slug,
            url: entry.nodeSetUrl,
          })

          const response = yield* client
            .get(entry.nodeSetUrl)
            .pipe(
              Effect.tapErrorCause((cause) =>
                Effect.logError(
                  `HTTP request failed for ${entry.nodeSetUrl}`,
                  cause,
                ),
              ),
            )

          const xmlContent = yield* response.text

          const nodeSet = yield* Effect.try({
            try: () => parseNodeSetXml(xmlContent, entry),
            catch: (cause) =>
              new NodeSetLoaderError({
                cause,
                message: `Failed to parse NodeSet XML from ${entry.nodeSetUrl}`,
              }),
          }).pipe(
            Effect.tapErrorCause((cause) =>
              Effect.logError(
                `XML parsing failed for ${entry.nodeSetUrl}`,
                cause,
              ),
            ),
          )

          yield* Effect.logInfo(
            `Loaded ${nodeSet.nodes.length} nodes for catalog slug ${entry.slug}`,
          )
          yield* Effect.annotateCurrentSpan({
            nodeCount: nodeSet.nodes.length,
            namespaceUris: entry.namespaceUris.join(","),
          })

          return nodeSet
        },
      )

      const loadNodeSet = Effect.fn("NodeSetLoaderSource.loadNodeSet")(
        function* (entry: NodeSetCatalogEntry) {
          return yield* fetchNodeSet(entry)
        },
      )

      const loadNodeSets = Effect.fn("NodeSetLoaderSource.loadNodeSets")(
        function* (entries: ReadonlyArray<NodeSetCatalogEntry>) {
          if (entries.length === 0) {
            yield* Effect.logInfo(
              "No NodeSet entries provided; returning empty set",
            )
            return new NodeSet({ namespaces: [], nodes: [] })
          }

          yield* Effect.logInfo(
            `Loading ${entries.length} NodeSet entries with concurrency 2`,
          )
          yield* Effect.annotateCurrentSpan({ nodeSetCount: entries.length })

          const nodeSets = yield* Effect.forEach(
            entries,
            (entry) => fetchNodeSet(entry),
            { concurrency: 2 },
          ).pipe(
            Effect.tapErrorCause((cause) =>
              Effect.logError("Failed to load one or more NodeSets", cause),
            ),
          )

          const merged = mergeNodeSets(nodeSets)

          yield* Effect.logInfo(
            `Loaded total of ${merged.nodes.length} nodes from ${entries.length} NodeSets`,
          )
          yield* Effect.annotateCurrentSpan({ totalNodes: merged.nodes.length })

          return merged
        },
      )

      const loadNodeSetBySlug = Effect.fn(
        "NodeSetLoaderSource.loadNodeSetBySlug",
      )(function* (slug: string) {
        const entry = yield* catalog.resolve(slug)
        return yield* fetchNodeSet(entry)
      })

      const loadDefaultNodeSets = Effect.fn(
        "NodeSetLoaderSource.loadDefaultNodeSets",
      )(function* () {
        const defaults = yield* catalog.defaults()
        return yield* loadNodeSets(defaults)
      })

      return {
        fetchNodeSet,
        loadNodeSet,
        loadNodeSets,
        loadNodeSetBySlug,
        loadDefaultNodeSets,
      } as const
    }),
    dependencies: [NodeSetCatalog.Default, NodeHttpClient.layerUndici],
  },
) {}

export class NodeSetLoader extends Effect.Service<NodeSetLoader>()(
  "NodeSetLoader",
  {
    scoped: Effect.gen(function* () {
      const catalog = yield* NodeSetCatalog
      const source = yield* NodeSetLoaderSource
      const keyValueStore = yield* KeyValueStore.KeyValueStore
      const nodeSetStore = keyValueStore.forSchema(NodeSet)

      const nodeSetCache = yield* Cache.make<string, NodeSet, unknown>({
        capacity: 64,
        timeToLive: Duration.days(7),
        lookup: (slug) =>
          Effect.gen(function* () {
            yield* Effect.annotateCurrentSpan({ slug })

            const persisted = yield* nodeSetStore.get(cacheKey(slug))
            if (Option.isSome(persisted)) {
              const maybeEntry = yield* catalog.resolve(slug).pipe(
                Effect.map(Option.some),
                Effect.catchAll((error) =>
                  error instanceof NodeSetCatalogNotFound
                    ? Effect.succeed(Option.none())
                    : Effect.fail(error),
                ),
              )
              const entryName = Option.match(maybeEntry, {
                onNone: () => slug,
                onSome: (entry) => entry.name,
              })

              yield* Effect.logInfo(
                `Recovered NodeSet ${entryName} from persistent cache`,
              )
              yield* Effect.annotateCurrentSpan({
                cacheSource: "persistent",
                nodeCount: persisted.value.nodes.length,
              })
              return persisted.value
            }

            yield* Effect.logInfo(
              `Cache miss for NodeSet ${slug}; loading via source`,
            )
            yield* Effect.annotateCurrentSpan({ cacheSource: "miss" })

            const nodeSet = yield* source.loadNodeSetBySlug(slug)

            yield* nodeSetStore.set(cacheKey(slug), nodeSet).pipe(
              Effect.tap(() =>
                Effect.logInfo(
                  `Persisted NodeSet ${slug} with ${nodeSet.nodes.length} nodes`,
                ),
              ),
              Effect.tapErrorCause((cause) =>
                Effect.logWarning(
                  `Failed to persist NodeSet ${slug} to KeyValueStore`,
                  cause,
                ),
              ),
            )

            return nodeSet
          }).pipe(Effect.withSpan("NodeSetLoader.cacheLookup")),
      })

      const loadNodeSet = Effect.fn("NodeSetLoader.loadNodeSet")(function* (
        entry: NodeSetCatalogEntry,
      ) {
        const nodeSet = yield* Effect.withSpan(
          nodeSetCache.get(entry.slug),
          "NodeSetLoader.cacheGet",
          { attributes: { sourceSlug: entry.slug } },
        )

        yield* Effect.annotateCurrentSpan({
          slug: entry.slug,
          nodeCount: nodeSet.nodes.length,
        })

        return nodeSet
      })

      const loadNodeSets = Effect.fn("NodeSetLoader.loadNodeSets")(function* (
        entries: ReadonlyArray<NodeSetCatalogEntry>,
      ) {
        if (entries.length === 0) {
          yield* Effect.logInfo(
            "No NodeSet entries provided; returning empty set",
          )
          return new NodeSet({ namespaces: [], nodes: [] })
        }

        yield* Effect.logInfo(
          `Loading ${entries.length} NodeSet entries with caching`,
        )
        yield* Effect.annotateCurrentSpan({ nodeSetCount: entries.length })

        const nodeSets = yield* Effect.forEach(
          entries,
          (entry) => loadNodeSet(entry),
          { concurrency: 2 },
        )

        const merged = mergeNodeSets(nodeSets)

        yield* Effect.logInfo(
          `Loaded total of ${merged.nodes.length} nodes from ${entries.length} NodeSets`,
        )
        yield* Effect.annotateCurrentSpan({ totalNodes: merged.nodes.length })

        return merged
      })

      const loadNodeSetBySlug = Effect.fn("NodeSetLoader.loadNodeSetBySlug")(
        function* (slug: string) {
          const nodeSet = yield* Effect.withSpan(
            nodeSetCache.get(slug),
            "NodeSetLoader.loadNodeSetBySlug.get",
          )

          yield* Effect.annotateCurrentSpan({
            slug,
            nodeCount: nodeSet.nodes.length,
          })

          return nodeSet
        },
      )

      const loadDefaultNodeSets = Effect.fn(
        "NodeSetLoader.loadDefaultNodeSets",
      )(function* () {
        const defaults = yield* catalog.defaults()
        return yield* loadNodeSets(defaults)
      })

      const ingestNodeSet = Effect.fn("NodeSetLoader.ingestNodeSet")(
        function* ({
          url,
          slug: providedSlug,
          name,
          description,
          category,
          documentationUrl,
          tags = [],
          namespaceUris = [],
          dependencies = [],
          defaultSelection = false,
        }: {
          readonly url: string
          readonly slug?: string
          readonly name?: string
          readonly description?: string
          readonly category?: string
          readonly documentationUrl?: string
          readonly tags?: ReadonlyArray<string>
          readonly namespaceUris?: ReadonlyArray<string>
          readonly dependencies?: ReadonlyArray<string>
          readonly defaultSelection?: boolean
        }) {
          const slug = providedSlug ?? `custom-${Date.now()}`

          const provisionalEntry = new NodeSetCatalogEntry({
            slug,
            name: name ?? slug,
            description,
            category,
            documentationUrl,
            tags: [...tags],
            namespaceUris: [...namespaceUris],
            nodeSetUrl: url,
            dependencies: [...dependencies],
            defaultSelection,
          })

          const nodeSet = yield* Effect.withSpan(
            source.fetchNodeSet(provisionalEntry),
            "NodeSetLoader.ingestNodeSet.fetch",
            { attributes: { slug, url } },
          )

          const derivedNamespaceUris = nodeSet.namespaces
            .map((ns) => ns.uri)
            .filter(
              (uri): uri is string => typeof uri === "string" && uri.length > 0,
            )

          const finalEntry = new NodeSetCatalogEntry({
            ...provisionalEntry,
            namespaceUris:
              provisionalEntry.namespaceUris.length > 0
                ? provisionalEntry.namespaceUris
                : derivedNamespaceUris,
          })

          yield* nodeSetStore.set(cacheKey(slug), nodeSet).pipe(
            Effect.tap(() =>
              Effect.logInfo(
                `Persisted ingested NodeSet ${slug} with ${nodeSet.nodes.length} nodes`,
              ),
            ),
            Effect.tapErrorCause((cause) =>
              Effect.logWarning(
                `Failed to persist ingested NodeSet ${slug}`,
                cause,
              ),
            ),
          )

          yield* nodeSetCache
            .set(slug, nodeSet)
            .pipe(
              Effect.tap(() =>
                Effect.logDebug(`Cached ingested NodeSet ${slug} in memory`),
              ),
            )

          yield* catalog.addNodeSet(finalEntry)

          return { entry: finalEntry, nodeSet } as const
        },
      )

      return {
        loadNodeSet,
        loadNodeSets,
        loadNodeSetBySlug,
        loadDefaultNodeSets,
        ingestNodeSet,
      } as const
    }),
    dependencies: [NodeSetCatalog.Default, NodeSetLoaderSource.Default],
  },
) {}
