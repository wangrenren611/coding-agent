import MessageList from "../components/message-list";
import TextInput from "../components/text-input";

  const messages: [] = []; // Mock messages array  

const ChatPage = () => {
  // Create provider (once)


  return (
    <box flexDirection="column" height={'100%'} width={'100%'} paddingLeft={2}>
      {/* Message list */}
      <scrollbox
        width={'100%'}
        viewportCulling={true}
        scrollbarOptions={{
          showArrows: false,
          visible: false,
        }}
      >
        <MessageList messages={messages} />
      </scrollbox>

      {/* Text input */}
      <TextInput
      />

    
    </box>
  );
};

export default ChatPage;
