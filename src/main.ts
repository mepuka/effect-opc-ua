#!/usr/bin/env node
import { Layer, Logger, LogLevel } from "effect"
import { NodeHttpClient } from "@effect/platform-node"
import { NodeStream, NodeSink, NodeRuntime } from "@effect/platform-node"
import { OpcUaDocsTools } from "./OpcUaDocs.js"
import { OpcUaGuides } from "./OpcUaGuides.js"
import { McpServer } from "@effect/ai"

// Compose all MCP features and launch
McpServer.layerStdio({
  name: "opcua-mcp",
  version: "0.1.0",
  stdin: NodeStream.stdin,
  stdout: NodeSink.stdout,
}).pipe(
  Layer.provide([OpcUaDocsTools, OpcUaGuides]),
  Layer.provide(Logger.minimumLogLevel(LogLevel.Info)),
  Layer.provide([NodeHttpClient.layerUndici]),
  Layer.launch,
  NodeRuntime.runMain,
)
