import BashTool from "./bash";
import { ToolRegistry, ToolRegistryConfig } from "./registry";

export const createDefaultToolRegistry = (config: ToolRegistryConfig) => {
    const toolRegistry = new ToolRegistry(config);
    toolRegistry.register([
            new BashTool(),
    ]);
    return toolRegistry;
}