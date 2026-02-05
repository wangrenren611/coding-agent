# Agent V4 Web Interface

A modern Next.js 15 web interface for the Agent V4 AI assistant, built with React 19, TypeScript, Tailwind CSS, and shadcn-ui components. Fully integrated with agent-v2 core engine.

## Features

- Modern dark-themed UI with shadcn-ui components
- Real-time chat interface with streaming messages
- Tool call visualization with status tracking
- Markdown rendering for message content
- Responsive design (mobile and desktop)
- State management powered by cli-v2 store
- **Direct integration with agent-v2 engine**

## Tech Stack

- **Next.js 15** - React framework with App Router
- **React 19** - UI library
- **TypeScript** - Type safety
- **Tailwind CSS** - Utility-first styling
- **shadcn-ui** - High-quality UI components
- **React Markdown** - Markdown rendering
- **Radix UI** - Accessible component primitives
- **agent-v2** - Core Agent engine

## Project Structure

```
web/
├── src/
│   ├── app/
│   │   ├── api/chat/route.ts  # Agent API route (integrates agent-v2)
│   │   ├── layout.tsx         # Root layout
│   │   ├── page.tsx           # Home page
│   │   └── globals.css        # Global styles
│   ├── components/
│   │   ├── ui/                # shadcn-ui components
│   │   ├── chat/              # Chat-related components
│   │   └── layout/            # Layout components
│   ├── hooks/
│   │   ├── use-chat-store.ts  # Chat state management (reuses cli-v2)
│   │   └── use-agent-api.ts   # Agent API client hook
│   ├── lib/
│   │   ├── utils.ts           # Utility functions
│   │   └── types.ts           # Type definitions (reuses cli-v2)
│   └── styles/
│       └── markdown.css       # Markdown styles
├── .env.development.local     # Environment variables (API keys)
├── components.json            # shadcn-ui configuration
├── next.config.js             # Next.js configuration (with webpack aliases)
├── tailwind.config.js         # Tailwind CSS configuration
├── tsconfig.json              # TypeScript configuration
└── package.json               # Dependencies and scripts
```

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm
- API key for GLM or other supported providers

### Installation

1. Navigate to the web directory:

```bash
cd web
```

2. Install dependencies:

```bash
pnpm install
```

3. Configure environment variables:

Create or edit `.env.development.local`:

```env
# GLM API Configuration
GLM_API_KEY=your_glm_api_key_here
GLM_API_BASE=https://open.bigmodel.cn/api/paas/v4

# Optional: Other providers
# MINIMAX_API_KEY=
# KIMI_API_KEY=
# DEEPSEEK_API_KEY=
```

4. Run the development server:

```bash
pnpm dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

### Build for Production

```bash
pnpm build
pnpm start
```

## Agent Integration

The web interface is fully integrated with `agent-v2`:

### API Routes

- **POST /api/chat** - Send messages to Agent and receive streaming responses
- **DELETE /api/chat** - Clear Agent session cache

### Supported Models

Configure the model in `src/app/api/chat/route.ts`:

```typescript
const provider = ProviderRegistry.createFromEnv('glm-4.7', {
  temperature: 0.7,
});
```

Available models:
- `glm-4.7` - GLM-4.7
- `minimax-2.1` - MiniMax-2.1
- `kimi-k2.5` - Kimi-K2.5
- `deepseek-chat` - DeepSeek

### Agent Features

- Streaming responses with real-time updates
- Tool execution (bash, file operations, web search, etc.)
- Code patch visualization
- Status tracking and error handling
- Session management

## State Management

The web interface shares state management logic with the CLI v2 interface:

- **Types**: Re-uses types from `src/cli-v2/state/types.ts`
- **Reducer**: Uses the same reducer from `src/cli-v2/state/reducer.ts`
- **Store Hook**: Adapts the chat store for web use
- **Stream Adapter**: Converts agent-v2 messages to UI events

## Components

### Chat Components

- `ChatContainer`: Main chat area with auto-scroll
- `ChatInput`: Message input with keyboard shortcuts
- `ChatMessages`: Message list container
- `MessageItem`: Individual message display with markdown
- `ToolCallItem`: Tool call visualization
- `SystemMessage`: System notification display

### Layout Components

- `Header`: App header with navigation and controls (Clear, Stop)
- `StatusBar`: Execution status and tool call list

### UI Components (shadcn-ui)

- Button
- Card
- ScrollArea
- Separator
- Badge
- Input

## Customization

### Colors

The color scheme uses CSS variables defined in `src/app/globals.css`. Modify the `:root` selector to customize colors.

### Components

Add or modify shadcn-ui components using:

```bash
npx shadcn-ui@latest add [component-name]
```

### Agent Configuration

Edit `src/app/api/chat/route.ts` to customize:

```typescript
const agent = new Agent({
  provider,
  systemPrompt: '你是一个智能助手，可以帮助用户完成各种任务。',
  stream: true,
  maxRetries: 10,
});
```

## Scripts

- `pnpm dev` - Start development server
- `pnpm build` - Build for production
- `pnpm start` - Start production server
- `pnpm lint` - Run ESLint

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Architecture

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│   Web Frontend  │ SSE  │   Next.js API    │      │   agent-v2      │
│  (React 19)     │────▶│   /api/chat      │────▶│   Engine        │
└─────────────────┘      └──────────────────┘      └─────────────────┘
        │                                                       │
        │                                                       │
        ▼                                                       ▼
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│ cli-v2 Store    │◀─────│  StreamAdapter   │◀─────│  Provider       │
│  (State Mgmt)   │      │  (Msg Converter) │      │  (LLM API)      │
└─────────────────┘      └──────────────────┘      └─────────────────┘
```

## License

ISC
