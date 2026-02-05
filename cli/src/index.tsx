import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import ChatPage from "./pages/chat";

function App() {
  return (
    <box alignItems="center" justifyContent="center" width={'100%'}>
      <ChatPage />
    </box>
  );
}

const renderer = await createCliRenderer();
createRoot(renderer).render(<App />);
