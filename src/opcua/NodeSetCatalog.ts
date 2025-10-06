import { Array, Data, Effect } from "effect"
import { NodeSetCatalogEntry } from "./types.js"
import type { NodeSetSlug } from "./types.js"

export class NodeSetCatalogNotFound extends Data.TaggedError(
  "NodeSetCatalogNotFound",
)<{ readonly slug: NodeSetSlug }> {}

const normalize = (value: string): string => value.trim().toLowerCase()

const catalogEntries: ReadonlyArray<NodeSetCatalogEntry> = [
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
    documentationUrl:
      "https://reference.opcfoundation.org/DI/v103/docs/",
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

const entryMap = new Map(
  Array.map(catalogEntries, (entry) => [normalize(entry.slug), entry] as const),
)

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
      const list = Effect.fn("NodeSetCatalog.list")(function* () {
        return catalogEntries
      })

      const defaults = Effect.fn("NodeSetCatalog.defaults")(function* () {
        return catalogEntries.filter((entry) => entry.defaultSelection)
      })

      const resolve = Effect.fn("NodeSetCatalog.resolve")(function* (
        slug: NodeSetSlug,
      ) {
        const normalizedSlug = normalize(slug)
        const entry = entryMap.get(normalizedSlug)

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

        const results = catalogEntries.filter((entry) =>
          matchesQuery(normalizedQuery, entry),
        )

        return results
      })

      return { list, search, resolve, defaults } as const
    }),
  },
) {}
