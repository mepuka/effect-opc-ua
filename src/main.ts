#!/usr/bin/env node
import { Layer, Logger, LogLevel } from "effect"
import {
  NodeStream,
  NodeSink,
  NodeContext,
  NodeRuntime,
} from "@effect/platform-node"
import { OpcUaDocsTools } from "./OpcUaDocs.js"
import { OpcUaNodeSetTools } from "./OpcUaNodeSets.js"
import { OpcUaGuides } from "./OpcUaGuides.js"
import { McpServer } from "@effect/ai"
import { KeyValueStore } from "@effect/platform"

// Compose all MCP features and launch
McpServer.layerStdio({
  name: "opcua-mcp",
  version: "0.1.0",
  stdin: NodeStream.stdin,
  stdout: NodeSink.stdout,
}).pipe(
  Layer.provide(NodeContext.layer),
  Layer.provideMerge(
    Layer.mergeAll(OpcUaDocsTools, OpcUaNodeSetTools, OpcUaGuides),
  ),
  Layer.provide(KeyValueStore.layerMemory),
  Layer.provide(Logger.minimumLogLevel(LogLevel.Info)),

  Layer.launch,
  NodeRuntime.runMain,
)
