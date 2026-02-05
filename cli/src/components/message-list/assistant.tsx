import { COLORS, ICONS } from "../../theme";

interface AssistantMessageProps {
  content: string;
  isStreaming?: boolean;
}

const AssistantMessage = ({ content, isStreaming }: AssistantMessageProps) => {
  return (
    <box flexDirection="row" marginTop={1}>
       <text fg={COLORS.assistant} marginRight={2}>{ICONS.assistant}</text>
       <text>{content}</text>
    </box>
  );
};

export default AssistantMessage;
