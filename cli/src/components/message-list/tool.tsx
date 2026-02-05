import { COLORS, ICONS } from "../../theme";



const ToolMessage = ({ content }: { content: string }) => {


  return (
    <box flexDirection="row" marginTop={1}>
       <text fg={COLORS.tool} marginRight={2}>{ICONS.tool}</text>
       <text>{content}</text>
 
    </box>
  );
};

export default ToolMessage;
