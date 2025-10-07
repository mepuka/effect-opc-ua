#!/usr/bin/env node
import { Layer, Logger, LogLevel } from "effect"
import {
  NodeStream,
  NodeSink,
  NodeRuntime,
  NodeKeyValueStore,
} from "@effect/platform-node"
import { OpcUaDocsTools } from "./OpcUaDocs.js"
import { OpcUaNodeSetTools } from "./OpcUaNodeSets.js"
import { OpcUaGuides } from "./OpcUaGuides.js"
import { McpServer } from "@effect/ai"

// Compose all MCP features and launch
McpServer.layerStdio({
  name: "opcua-mcp",
  version: "0.1.0",
  stdin: NodeStream.stdin,
  stdout: NodeSink.stdout,
}).pipe(
  Layer.provide([OpcUaDocsTools, OpcUaNodeSetTools, OpcUaGuides]),
  Layer.provideMerge(NodeKeyValueStore.layerFileSystem("/tmp/opcua-mcp-cache")),
  Layer.provide(Logger.minimumLogLevel(LogLevel.Info)),
  Layer.launch,
  NodeRuntime.runMain,
)
