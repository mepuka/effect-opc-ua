import { Schema, Option } from "effect"

// NodeId representation
export class NodeId extends Schema.Class<NodeId>("NodeId")({
  namespaceIndex: Schema.Number,
  identifierType: Schema.Literal("Numeric", "String", "Guid", "Opaque"),
  identifier: Schema.String,
}) {
  toString(): string {
    const idType = this.identifierType.toLowerCase()
    return `ns=${this.namespaceIndex};${idType}=${this.identifier}`
  }
}

// NodeClass enumeration - using Literal union for simplicity
export const NodeClass = Schema.Literal(
  "Object",
  "Variable",
  "Method",
  "ObjectType",
  "VariableType",
  "ReferenceType",
  "DataType",
  "View",
)
export type NodeClass = Schema.Schema.Type<typeof NodeClass>

// Reference representation
export class Reference extends Schema.Class<Reference>("Reference")({
  referenceType: Schema.String,
  isForward: Schema.Boolean,
  targetNodeId: NodeId,
}) {}

// LocalizedText
export class LocalizedText extends Schema.Class<LocalizedText>("LocalizedText")(
  {
    locale: Schema.optional(Schema.String),
    text: Schema.String,
  },
) {}

// ParsedUANode - the main node structure
export class ParsedUANode extends Schema.Class<ParsedUANode>("ParsedUANode")({
  nodeId: NodeId,
  nodeClass: NodeClass,
  browseName: Schema.String,
  displayName: LocalizedText,
  description: Schema.OptionFromUndefinedOr(LocalizedText),
  namespaceUri: Schema.optional(Schema.String),
  references: Schema.Array(Reference),
  // Type-specific fields
  dataType: Schema.optional(Schema.String), // For Variables
  valueRank: Schema.optional(Schema.Number), // For Variables
  isAbstract: Schema.optional(Schema.Boolean), // For Types
  symmetric: Schema.optional(Schema.Boolean), // For ReferenceTypes
}) {}

// NodeSet namespace metadata
export class NamespaceMetadata extends Schema.Class<NamespaceMetadata>(
  "NamespaceMetadata",
)({
  uri: Schema.String,
  publicationDate: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
}) {}

// Complete NodeSet structure
export class NodeSet extends Schema.Class<NodeSet>("NodeSet")({
  namespaces: Schema.Array(NamespaceMetadata),
  nodes: Schema.Array(ParsedUANode),
}) {}

// NodeSet catalog metadata
export const NodeSetSlug = Schema.String.pipe(
  Schema.annotations({
    description: "Unique identifier for a NodeSet catalog entry",
  }),
)
export type NodeSetSlug = Schema.Schema.Type<typeof NodeSetSlug>

export class NodeSetCatalogEntry extends Schema.Class<NodeSetCatalogEntry>(
  "NodeSetCatalogEntry",
)({
  slug: NodeSetSlug,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  category: Schema.optional(Schema.String),
  documentationUrl: Schema.optional(Schema.String),
  tags: Schema.Array(Schema.String),
  namespaceUris: Schema.Array(Schema.String),
  nodeSetUrl: Schema.String,
  dependencies: Schema.Array(NodeSetSlug),
  defaultSelection: Schema.Boolean,
}) {}

// Document entry for search results
export interface NodeDocumentEntry {
  readonly id: number
  readonly nodeId: string
  readonly title: string
  readonly description?: string
  readonly nodeClass: NodeClass
  readonly namespace?: string
  readonly node: ParsedUANode
}
