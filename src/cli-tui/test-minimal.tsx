/**
 * Debug test
 */

console.log('=== Starting debug test ===');
console.log('process.platform:', process.platform);
console.log('process.arch:', process.arch);
console.log('isTTY:', { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY });

import { createCliRenderer } from '@opentui/core';

console.log('createCliRenderer imported');

async function run() {
  console.log('Creating renderer...');
  try {
    const renderer = await createCliRenderer({
      exitOnCtrlC: true,
    });
    console.log('Renderer created:', renderer);

    const { createRoot } = await import('@opentui/react');
    console.log('createRoot imported');

    const root = createRoot(renderer);
    console.log('Root created');

    const App = () => {
      console.log('App rendering');
      return (
        <box padding={2}>
          <text bold>Test</text>
          <input focused={true} placeholder="Type here" />
        </box>
      );
    };

    root.render(<App />);
    console.log('Rendered!');

    return new Promise<void>(() => {});
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

run().catch(console.error);
