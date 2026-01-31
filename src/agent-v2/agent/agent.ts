import { Session } from "../session";
import { ToolDefinition, ToolSchema } from "../tool/type";
import { AgentOptions, AgentStatus } from "./types";

export class Agent{
    /** Agent 状态 */
    private status: AgentStatus;
    private abortController: AbortController | null = null;
    private provider: AgentOptions['provider'];
    private systemPrompt: string;
    private session: Session;
    private tools: ToolDefinition[];
    
    constructor(config: AgentOptions) {
        console.log('Agent');
        this.status = AgentStatus.IDLE;
        this.provider = config.provider;
        this.systemPrompt = config.systemPrompt;
        this.session = new Session({
            systemPrompt: this.systemPrompt,
        });
        this.tools = config.tools||[];
    }



    async execute(query: string) {
        this.session.addMessage({ messageId: 'user', role: 'user', content: query });

    }

   async loop() {
       while (true) {
          this.abortController = new AbortController();
           const messages = this.session.getMessages();

           const ToolSchemaList = this.tools.map(tool => tool.parameters);

           this.provider.generate(messages,{
                tools: ToolSchemaList,
           });
       }
    }
}