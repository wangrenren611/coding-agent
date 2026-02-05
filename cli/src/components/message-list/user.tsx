import { COLORS, ICONS } from "../../theme";

const UserMessage = ({ content }: { content: string }) => {
  return (
    <box flexDirection="row" marginTop={1}>
      <text fg={COLORS.user} marginRight={1}>{ICONS.user}</text>
      <text fg={COLORS.user}>{content}</text>
    </box>
  );
};
export type Message = {
  role: 'user';
  content: string;
}
export default UserMessage;