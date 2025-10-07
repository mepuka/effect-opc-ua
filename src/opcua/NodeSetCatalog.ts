import {
  Cache,
  Data,
  Duration,
  Effect,
  HashMap,
  Option,
  Ref,
  Schema,
} from "effect"
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  KeyValueStore,
} from "@effect/platform"
import { NodeHttpClient } from "@effect/platform-node"
import type { NodeSetSlug } from "./types.js"
import { NodeSetCatalogEntry } from "./types.js"

const GITHUB_OWNER = "OPCFoundation"
const GITHUB_REPO = "UA-Nodeset"
const GITHUB_REF = "latest"
const GITHUB_API_ROOT = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`

export class NodeSetCatalogNotFound extends Data.TaggedError(
  "NodeSetCatalogNotFound",
)<{ readonly slug: NodeSetSlug }> {}

export class NodeSetCatalogFetchError extends Data.TaggedError(
  "NodeSetCatalogFetchError",
)<{ readonly cause: unknown; readonly message: string }> {}

const normalize = (value: string): string => value.trim().toLowerCase()

const catalogKey = "catalog"
const catalogSchema = Schema.Array(NodeSetCatalogEntry)

const GitHubTreeEntry = Schema.Struct({
  path: Schema.String,
  type: Schema.String,
})

const GitHubTreeResponse = Schema.Struct({
  tree: Schema.Array(GitHubTreeEntry),
  truncated: Schema.optional(Schema.Boolean),
})

const NODESET_FILE_PATTERN = /\.NodeSet2\.xml$/i

const builtinEntries: ReadonlyArray<NodeSetCatalogEntry> = [
  new NodeSetCatalogEntry({
    slug: "core",
    name: "OPC UA Core (NodeSet2)",
    description:
      "Base OPC UA information model containing the core NodeClasses and reference definitions.",
    category: "Core",
    documentationUrl:
      "https://reference.opcfoundation.org/Core/Part3/v105/docs/",
    tags: ["core", "standard", "opc", "ua"],
    namespaceUris: ["http://opcfoundation.org/UA/"],
    nodeSetUrl:
      "https://raw.githubusercontent.com/OPCFoundation/UA-Nodeset/latest/Schema/Opc.Ua.NodeSet2.xml",
    dependencies: [],
    defaultSelection: true,
  }),
  new NodeSetCatalogEntry({
    slug: "di",
    name: "Device Integration (DI)",
    description:
      "Companion specification defining reusable components for device integration models.",
    category: "Companion Specification",
    documentationUrl: "https://reference.opcfoundation.org/DI/v103/docs/",
    tags: ["device", "integration", "companion"],
    namespaceUris: ["http://opcfoundation.org/UA/DI/"],
    nodeSetUrl:
      "https://raw.githubusercontent.com/OPCFoundation/UA-Nodeset/latest/DI/Opc.Ua.Di.NodeSet2.xml",
    dependencies: ["core"],
    defaultSelection: true,
  }),
  new NodeSetCatalogEntry({
    slug: "packml",
    name: "PackML",
    description:
      "Packaging machine language companion model extending the DI base types.",
    category: "Companion Specification",
    documentationUrl:
      "https://opcfoundation.org/developer-tools/specifications-opc-ua-information-models/packml/",
    tags: ["packml", "packaging", "machine"],
    namespaceUris: ["http://opcfoundation.org/UA/PackML/"],
    nodeSetUrl:
      "https://raw.githubusercontent.com/OPCFoundation/UA-Nodeset/latest/PackML/Opc.Ua.PackML.NodeSet2.xml",
    dependencies: ["core", "di"],
    defaultSelection: true,
  }),
  new NodeSetCatalogEntry({
    slug: "adi",
    name: "Analyzer Devices (ADI)",
    description:
      "Information model for analyzer device integration with lab and process systems.",
    category: "Companion Specification",
    documentationUrl:
      "https://opcfoundation.org/developer-tools/specifications-opc-ua-information-models/analyzer-devices/",
    tags: ["analyzer", "devices", "process"],
    namespaceUris: ["http://opcfoundation.org/UA/ADI/"],
    nodeSetUrl:
      "https://raw.githubusercontent.com/OPCFoundation/UA-Nodeset/latest/ADI/Opc.Ua.Adi.NodeSet2.xml",
    dependencies: ["core", "di"],
    defaultSelection: false,
  }),
  new NodeSetCatalogEntry({
    slug: "autoid",
    name: "AutoID",
    description:
      "AutoID companion specification covering RFID, barcode, and related identification systems.",
    category: "Companion Specification",
    documentationUrl:
      "https://opcfoundation.org/developer-tools/specifications-opc-ua-information-models/autoid/",
    tags: ["autoid", "rfid", "barcode"],
    namespaceUris: ["http://opcfoundation.org/UA/AutoID/"],
    nodeSetUrl:
      "https://raw.githubusercontent.com/OPCFoundation/UA-Nodeset/latest/AutoID/Opc.Ua.AutoID.NodeSet2.xml",
    dependencies: ["core"],
    defaultSelection: false,
  }),
  new NodeSetCatalogEntry({
    slug: "machinery",
    name: "Machinery",
    description:
      "Base machinery companion model providing common equipment abstractions.",
    category: "Companion Specification",
    documentationUrl:
      "https://opcfoundation.org/developer-tools/specifications-opc-ua-information-models/machinery/",
    tags: ["machinery", "equipment", "companion"],
    namespaceUris: ["http://opcfoundation.org/UA/Machinery/"],
    nodeSetUrl:
      "https://raw.githubusercontent.com/OPCFoundation/UA-Nodeset/latest/Machinery/Opc.Ua.Machinery.NodeSet2.xml",
    dependencies: ["core"],
    defaultSelection: false,
  }),
  new NodeSetCatalogEntry({
    slug: "robotics",
    name: "Robotics",
    description:
      "Robotics companion information model extending the machinery framework.",
    category: "Companion Specification",
    documentationUrl:
      "https://opcfoundation.org/developer-tools/specifications-opc-ua-information-models/robotics/",
    tags: ["robotics", "motion", "companion"],
    namespaceUris: ["http://opcfoundation.org/UA/Robotics/"],
    nodeSetUrl:
      "https://raw.githubusercontent.com/OPCFoundation/UA-Nodeset/latest/Robotics/Opc.Ua.Robotics.NodeSet2.xml",
    dependencies: ["core", "machinery"],
    defaultSelection: false,
  }),
]

const builtinMetadata = HashMap.fromIterable(
  builtinEntries.map((entry) => [normalize(entry.slug), entry] as const),
)

const mergeEntries = (
  primary: ReadonlyArray<NodeSetCatalogEntry>,
  fallback: ReadonlyArray<NodeSetCatalogEntry>,
  overrides: ReadonlyArray<NodeSetCatalogEntry>,
): ReadonlyArray<NodeSetCatalogEntry> => {
  const map = new Map<string, NodeSetCatalogEntry>()

  for (const entry of primary) {
    map.set(normalize(entry.slug), entry)
  }

  for (const entry of fallback) {
    const slug = normalize(entry.slug)
    if (!map.has(slug)) {
      map.set(slug, entry)
    }
  }

  for (const entry of overrides) {
    map.set(normalize(entry.slug), entry)
  }

  return Array.from(map.values())
}

const humanizeSegment = (segment: string): string => {
  const spaced = segment
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()

  return spaced
    .split(" ")
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ")
}

const createEntry = (
  slug: string,
  displaySegment: string,
  nodeSetPath: string,
): NodeSetCatalogEntry => {
  const metadata = Option.getOrNull(HashMap.get(builtinMetadata, slug))
  const defaultTags = [slug]

  return new NodeSetCatalogEntry({
    slug,
    name: metadata?.name ?? humanizeSegment(displaySegment),
    description: metadata?.description,
    category: metadata?.category,
    documentationUrl: metadata?.documentationUrl,
    tags: metadata?.tags ?? defaultTags,
    namespaceUris: metadata?.namespaceUris ?? [],
    nodeSetUrl: `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_REF}/${encodeURI(
      nodeSetPath,
    )}`,
    dependencies: metadata?.dependencies ?? [],
    defaultSelection: metadata?.defaultSelection ?? false,
  })
}

const slugFromPath = (
  path: string,
): Option.Option<{ readonly slug: string; readonly segment: string }> => {
  const [segment] = path.split("/")
  if (!segment) {
    return Option.none()
  }

  if (segment === "Schema") {
    return Option.some({ slug: "core", segment: "Core" })
  }

  return Option.some({ slug: normalize(segment), segment })
}

const matchesQuery = (query: string, entry: NodeSetCatalogEntry): boolean => {
  if (query.length === 0) {
    return true
  }

  const haystack = [
    entry.slug,
    entry.name,
    entry.category ?? "",
    entry.description ?? "",
    entry.documentationUrl ?? "",
    entry.tags.join(" "),
  ]
    .map(normalize)
    .join(" ")

  return haystack.includes(query)
}

export class NodeSetCatalog extends Effect.Service<NodeSetCatalog>()(
  "NodeSetCatalog",
  {
    scoped: Effect.gen(function* () {
      const keyValueStore = yield* KeyValueStore.KeyValueStore
      const httpClient = (yield* HttpClient.HttpClient).pipe(
        HttpClient.filterStatusOk,
        HttpClient.mapRequest(
          HttpClientRequest.setHeaders({
            Accept: "application/vnd.github+json",
            "User-Agent": "https://github.com/opcua-org/node-opcua",
          }),
        ),
      )

      const catalogStore = keyValueStore.forSchema(catalogSchema)
      const persistedEntries = yield* catalogStore
        .get(catalogKey)
        .pipe(Effect.map(Option.getOrElse(() => [])))

      const persistedRef =
        yield* Ref.make<ReadonlyArray<NodeSetCatalogEntry>>(persistedEntries)

      const fetchRemoteEntries = Effect.fn("NodeSetCatalog.fetchRemoteEntries")(
        function* () {
          const url = `${GITHUB_API_ROOT}/git/trees/${GITHUB_REF}?recursive=1`

          const response = yield* httpClient.get(url).pipe(
            Effect.andThen((res) =>
              HttpClientResponse.schemaBodyJson(GitHubTreeResponse)(res),
            ),
            Effect.tapErrorCause((cause) =>
              Effect.logError("Failed to request GitHub NodeSet tree", cause),
            ),
            Effect.mapError(
              (cause) =>
                new NodeSetCatalogFetchError({
                  cause,
                  message: "Failed to download GitHub NodeSet tree",
                }),
            ),
          )

          const entries = new Map<string, NodeSetCatalogEntry>()

          for (const item of response.tree) {
            if (item.type !== "blob" || !NODESET_FILE_PATTERN.test(item.path)) {
              continue
            }

            const slugInfo = slugFromPath(item.path)
            if (Option.isNone(slugInfo)) {
              continue
            }

            const { slug, segment } = slugInfo.value

            if (entries.has(slug)) {
              continue
            }

            const entry = createEntry(slug, segment, item.path)
            entries.set(slug, entry)
          }

          if (response.truncated === true) {
            yield* Effect.logWarning(
              "GitHub tree response was truncated; NodeSet catalog may be incomplete",
            )
          }

          return Array.from(entries.values())
        },
      )

      const remoteCache = yield* Cache.make<
        string,
        ReadonlyArray<NodeSetCatalogEntry>,
        NodeSetCatalogFetchError
      >({
        capacity: 1,
        timeToLive: Duration.hours(6),
        lookup: () =>
          fetchRemoteEntries().pipe(
            Effect.tap((entries) =>
              Effect.logInfo(
                `Discovered ${entries.length} NodeSets from GitHub repository`,
              ),
            ),
          ),
      })

      const computeEntries = Effect.fn("NodeSetCatalog.computeEntries")(
        function* () {
          const persisted = yield* Ref.get(persistedRef)

          const remote = yield* remoteCache.get("catalog").pipe(
            Effect.catchAll((cause) =>
              Effect.gen(function* () {
                yield* Effect.logWarning(
                  "Falling back to built-in NodeSet catalog due to fetch failure",
                  cause,
                )
                return builtinEntries
              }),
            ),
          )

          const mergedRemote = mergeEntries(remote, builtinEntries, [])
          return mergeEntries(mergedRemote, [], persisted)
        },
      )

      const list = Effect.fn("NodeSetCatalog.list")(function* () {
        return yield* computeEntries()
      })

      const defaults = Effect.fn("NodeSetCatalog.defaults")(function* () {
        const entries = yield* computeEntries()
        return entries.filter((entry) => entry.defaultSelection)
      })

      const resolve = Effect.fn("NodeSetCatalog.resolve")(function* (
        slug: NodeSetSlug,
      ) {
        const normalizedSlug = normalize(slug)
        const entries = yield* computeEntries()

        const entry = entries.find(
          (candidate) => normalize(candidate.slug) === normalizedSlug,
        )

        if (!entry) {
          return yield* Effect.fail(
            new NodeSetCatalogNotFound({ slug: normalizedSlug }),
          )
        }

        return entry
      })

      const search = Effect.fn("NodeSetCatalog.search")(function* (
        query: string,
      ) {
        const normalizedQuery = normalize(query)
        const entries = yield* computeEntries()
        return entries.filter((entry) => matchesQuery(normalizedQuery, entry))
      })

      const addNodeSet = Effect.fn("NodeSetCatalog.addNodeSet")(function* (
        entry: NodeSetCatalogEntry,
      ) {
        const normalizedSlug = normalize(entry.slug)

        const nextPersisted = yield* Ref.modify(persistedRef, (current) => {
          const filtered = current.filter(
            (persistedEntry) =>
              normalize(persistedEntry.slug) !== normalizedSlug,
          )
          const updated = [...filtered, entry]
          return [updated, updated] as const
        })

        yield* catalogStore.set(catalogKey, nextPersisted).pipe(
          Effect.tap(() =>
            Effect.logInfo(
              `Persisted NodeSet catalog entry ${entry.slug} (${entry.name})`,
            ),
          ),
          Effect.tapErrorCause((cause) =>
            Effect.logWarning(
              `Failed to persist NodeSet catalog entry ${entry.slug}`,
              cause,
            ),
          ),
        )
      })

      return { list, defaults, resolve, search, addNodeSet } as const
    }),
    dependencies: [NodeHttpClient.layerUndici],
  },
) {}
