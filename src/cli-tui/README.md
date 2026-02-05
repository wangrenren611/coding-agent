# cli-tui

OpenTUI-based CLI for AI Coding Agent.

## Features

- **OpenTUI Framework**: Built with OpenTUI for modern terminal UI
- **React Components**: Uses React with OpenTUI renderer
- **Streaming Support**: Real-time streaming of AI responses
- **Tool Call Display**: Shows tool invocations with status
- **Keyboard Shortcuts**: Full keyboard navigation support
- **Message History**: Persistent input history
- **Code Patch Display**: Shows code diffs with syntax highlighting
- **Error Handling**: Comprehensive error handling and display

## Project Structure

```
cli-tui/
├── agent/
│   ├── stream-adapter.ts    # Converts Agent messages to UI events
│   └── use-agent-runner.tsx # Agent lifecycle management hook
├── state/
│   ├── chat-store.tsx       # React Context for state management
│   └── reducer.ts           # State reducer for UI events
├── ui/
│   ├── theme.ts             # Theme constants and styles
│   ├── message-list.tsx     # Scrollable message display
│   ├── status-bar.tsx       # Status and loading indicator
│   └── input-bar.tsx        # Text input with history
├── types/
│   └── index.ts             # Type definitions
├── app.tsx                  # Main app component
├── index.tsx                # Entry point
├── package.json             # Dependencies
└── tsconfig.json            # TypeScript config
```

## Usage

```bash
# Run with bun
pnpm dev:cli-tui

# Or directly
bun run src/cli-tui/index.tsx
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Ctrl+C` | Exit |
| `Ctrl+H` | Toggle help |
| `Esc` | Close overlay |
| `↑/↓` | History navigation |
| `PageUp/PageDown` | Scroll messages |

## Commands

| Command | Description |
|---------|-------------|
| `/help` | Show help |
| `/clear` | Clear screen |
| `/exit` | Exit application |

## Architecture

### State Management

Uses React Context API with useReducer for state management:

- `ChatProvider`: Context provider for chat state
- `useChatStore`: Hook to access chat state
- `chatReducer`: Reducer for handling UI events

### Agent Integration

- `StreamAdapter`: Converts Agent stream messages to UI events
- `useAgentRunner`: Hook managing Agent lifecycle

### UI Components

All components use OpenTUI's React renderer:

- `<box>`: Layout container
- `<text>`: Text display
- `<scrollbox>`: Scrollable container
- `<input>`: Text input
- `useKeyboard`: Keyboard event handling

## Comparison with cli-v2

| Feature | cli-v2 (Ink) | cli-tui (OpenTUI) |
|---------|-------------|-------------------|
| Framework | Ink + React | OpenTUI + React |
| Renderer | Ink | OpenTUI Core |
| Layout | Flexbox | Flexbox (Yoga) |
| Input | ink-text-input | OpenTUI input |
| Scrolling | Custom | scrollbox component |
| Animations | ink-spinner | useTimeline |
| State | React hooks | React hooks |

## Development

```bash
# Type check
bun typecheck

# Run
bun run index.tsx
```

## Notes

- Requires Bun runtime
- Requires interactive terminal (TTY)
- Compatible with existing agent-v2 and providers
