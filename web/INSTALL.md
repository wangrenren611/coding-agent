# Installation & Setup Guide

## Quick Start

### 1. Navigate to the web directory

```bash
cd web
```

### 2. Install dependencies

```bash
npm install
```

### 3. Run the development server

```bash
npm run dev
```

The application will be available at [http://localhost:3000](http://localhost:3000)

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Build the application for production |
| `npm start` | Start production server |
| `npm run lint` | Run ESLint to check code quality |

## Dependencies Overview

### Core Dependencies
- **next**: ^15.3.4 - React framework
- **react**: ^19.1.0 - UI library
- **react-dom**: ^19.1.0 - React DOM bindings
- **typescript**: ^5 - Type safety

### UI Dependencies
- **tailwindcss**: ^3.4.17 - Utility-first CSS
- **@radix-ui/react-scroll-area**: ^1.2.4 - Scroll area component
- **@radix-ui/react-separator**: ^1.1.2 - Separator component
- **lucide-react**: ^0.528.0 - Icon library
- **react-markdown**: ^10.1.0 - Markdown rendering
- **remark-gfm**: ^4.0.0 - GitHub Flavored Markdown

### Utility Dependencies
- **class-variance-authority**: ^0.7.1 - Component variants
- **clsx**: ^2.1.1 - Conditional classes
- **tailwind-merge**: ^3.2.0 - Merge Tailwind classes

## Troubleshooting

### Port already in use

If port 3000 is already in use, you can specify a different port:

```bash
npm run dev -- -p 3001
```

### Build errors

If you encounter build errors, try:

1. Clear the Next.js cache:
```bash
rm -rf .next
```

2. Reinstall dependencies:
```bash
rm -rf node_modules package-lock.json
npm install
```

3. Rebuild:
```bash
npm run build
```

### TypeScript errors

Ensure you're using the correct TypeScript version:

```bash
npm install typescript@^5 -D
```

## Development Tips

1. **Hot Reload**: The development server supports hot module replacement, so changes are reflected immediately.

2. **Type Checking**: TypeScript provides real-time type checking in your IDE.

3. **Component Library**: Use `npx shadcn-ui@latest add [component]` to add more shadcn-ui components.

4. **State Management**: The chat state is managed by the shared cli-v2 store, ensuring consistency between CLI and web interfaces.

## Next Steps

- Customize the color scheme in `src/app/globals.css`
- Add more UI components from shadcn-ui
- Implement actual agent API integration in `src/app/page.tsx`
- Add error boundaries and loading states
- Implement user authentication (if needed)
