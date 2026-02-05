import AssistantMessage from "./assistant";
import UserMessage from "./user";
import ToolMessage from "./tool";


type MessageListProps = {
  messages: {
    id: string;
    type: string;
    role: string;
    content: string;
    isStreaming?: boolean;
    tool?: {
      name: string;
      status: string;
    };
    timestamp?: number;
  }[];
}

const MessageList = ({ messages }: MessageListProps) => {

  return (
    <box>
       {messages.map((message) => {
        switch (message.type) {
          case 'text':
            if (message.role === 'user') {
              return <UserMessage key={message.id} content={message.content} />;
            }
            return (
              <AssistantMessage
                key={message.id}
                content={message.content}
                isStreaming={message.isStreaming}
              />
            );
          case 'tool-call':
          case 'tool-result':
            return (
              <ToolMessage
                key={message.id}
                content={message.content}
              />
            );
        }
      })}
    </box>
  );
};

export default MessageList;
