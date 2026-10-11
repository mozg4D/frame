// Tiny adapter: source-paths verifies this source against the exact native bundle.
import {sources} from '../support/source-paths.mjs';
const topology=await import(sources.topology.href);
export const {topologyStamp,captureTopology,buildTopologyWork,topologyTransfer,connectedMaskWork,edgeIdFromRaw,drainCooperatively}=topology;
