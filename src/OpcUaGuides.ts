import { Effect, Layer, Array } from "effect"
import { McpServer } from "@effect/ai"

export const opcUaGuides = [
  {
    name: "OPC UA Overview",
    title: "OPC UA Overview and Concepts",
    description: `Overview of OPC UA (Unified Architecture) concepts, architecture, and use cases.
Covers:
- What is OPC UA
- Information modeling
- Address space concepts
- Nodes, references, and attributes
- Security model
- Client-server architecture`,
    url: "https://reference.opcfoundation.org/Core/Part1/v105/docs/",
  },
  {
    name: "Address Space Model",
    title: "OPC UA Address Space Model",
    description: `Detailed guide to the OPC UA Address Space and information modeling.
Covers:
- NodeClasses (Object, Variable, Method, etc.)
- References and reference types
- Browse paths and naming conventions
- Type hierarchies
- Modeling rules`,
    url: "https://reference.opcfoundation.org/Core/Part3/v105/docs/",
  },
  {
    name: "Services",
    title: "OPC UA Services",
    description: `OPC UA service sets for client-server communication.
Covers:
- Browse and discovery services
- Read and write services
- Method call services
- Subscription and monitoring services
- Session management`,
    url: "https://reference.opcfoundation.org/Core/Part4/v105/docs/",
  },
  {
    name: "Data Encoding",
    title: "OPC UA Data Encoding",
    description: `Information about OPC UA binary and XML encoding formats.
Covers:
- Built-in data types
- Structured data types
- Binary encoding
- XML encoding
- JSON encoding`,
    url: "https://reference.opcfoundation.org/Core/Part6/v105/docs/",
  },
] as const

export const nodeSetGuides = [
  {
    name: "Companion Specifications",
    title: "OPC UA Companion Specifications",
    description: `Guide to OPC UA companion specifications for industry-specific information models.
Includes:
- Device Integration (DI)
- Analyzer Devices (ADI)
- AutoID
- Machine Tools
- Robotics
- PackML`,
    url: "https://opcfoundation.org/developer-tools/specifications-opc-ua-information-models/",
  },
  {
    name: "NodeSet Files",
    title: "Working with NodeSet2 XML Files",
    description: `Guide to understanding and working with NodeSet2 XML files.
Covers:
- NodeSet2 schema
- Importing and exporting models
- Namespace management
- Model dependencies
- Validation`,
    url: "https://github.com/OPCFoundation/UA-Nodeset/blob/latest/README.md",
  },
] as const

export const bestPractices = [
  {
    name: "Information Modeling Best Practices",
    title: "OPC UA Information Modeling Best Practices",
    description: `Best practices for creating OPC UA information models.
Covers:
- Naming conventions
- Type design patterns
- Reference usage guidelines
- Documentation standards
- Model organization`,
    url: "https://reference.opcfoundation.org/Core/Part3/v105/docs/7.1/",
  },
  {
    name: "Security Best Practices",
    title: "OPC UA Security Best Practices",
    description: `Security guidelines and best practices for OPC UA applications.
Covers:
- Certificate management
- User authentication
- Encryption and signing
- Security policies
- Audit logging`,
    url: "https://reference.opcfoundation.org/Core/Part2/v105/docs/",
  },
] as const

export const OpcUaGuides = Layer.mergeAll(
  ...Array.map(opcUaGuides, (guide: any) =>
    McpServer.resource({
      uri: `opcua://guide/${guide.name}`,
      name: guide.title,
      description: guide.description,
      content: Effect.succeed(
        `# ${guide.title}\n\n${guide.description}\n\nFor more information, visit: ${guide.url}`,
      ),
    }),
  ),
  ...Array.map(nodeSetGuides, (guide) =>
    McpServer.resource({
      uri: `opcua://nodeset-guide/${guide.name}`,
      name: guide.title,
      description: guide.description,
      content: Effect.succeed(
        `# ${guide.title}\n\n${guide.description}\n\nFor more information, visit: ${guide.url}`,
      ),
    }),
  ),
  ...Array.map(bestPractices, (guide) =>
    McpServer.resource({
      uri: `opcua://best-practices/${guide.name}`,
      name: guide.title,
      description: guide.description,
      content: Effect.succeed(
        `# ${guide.title}\n\n${guide.description}\n\nFor more information, visit: ${guide.url}`,
      ),
    }),
  ),
)
