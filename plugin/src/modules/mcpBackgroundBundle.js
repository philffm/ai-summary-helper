// Entry of the background bundle (mcp-worker.js, global AISH_MCP): the local-MCP relay client for the classic-script background.
import { createMcpClient, toolDefinitions, toolList } from './mcp/client.js';
import { TOOLS, TOOL_SCOPE } from './mcp/tools.js';

export const API = { createMcpClient, toolDefinitions, toolList, TOOLS, TOOL_SCOPE };
