/**
 * Minimal test - just input component
 */

import React, { useState } from 'react';
import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';

export const MinimalApp: React.FC = () => {
  const [value, setValue] = useState('');

  return (
    <box padding={2}>
      <text bold>Minimal Input Test</text>
      <text>{'\n\n'}</text>
      <text>Current value: "{value}"</text>
      <text>{'\n\n'}</text>
      <box borderStyle="single" padding={1}>
        <text color="green">{'> '} </text>
        <input
          value={value}
          onInput={setValue}
          onSubmit={(v) => console.log('Submitted:', v)}
          placeholder="Type here..."
          focused={true}
        />
      </box>
      <text>{'\n\n'}</text>
      <text dimColor>Type something and press Enter to submit.</text>
      <text dimColor>{'\nPress Ctrl+C to exit.'}</text>
    </box>
  );
};

export async function main() {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  });

  const root = createRoot(renderer);
  root.render(<MinimalApp />);

  return new Promise<void>(() => {});
}
