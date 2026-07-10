#!/usr/bin/env node
// offgrid-gateway-cluster — run the multinode router/aggregator standalone.
//
//   OFFGRID_POOL='[{"name":"g1","host":"192.168.1.57","port":7878,"model":"qwen3.5-9b","vision":true}]' \
//   OFFGRID_CLUSTER_PORT=8800 offgrid-gateway-cluster
//
// One OpenAI-compatible endpoint across the pool, with true inference health
// and plug-and-play observability (OFFGRID_OPENSEARCH_URL / OFFGRID_LANGFUSE_*
// wire sinks automatically; stdout is always on). This is the bottom layer the
// console (and any host) builds Chat / Projects / RAG / Artifacts on top of.
import { createClusterGateway } from './cluster/server';

createClusterGateway().listen();
