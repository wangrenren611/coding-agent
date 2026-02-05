/**
 * Simple input test for debugging
 */

import React, { useState } from 'react';
import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';

function TestApp() {
  const [value, setValue] = useState('');

  const handleSubmit = (newValue: string) => {
    console.log('Submitted:', newValue);
    setValue('');
  };

  return (
    <box flexDirection="column" paddingX={1} paddingY={1}>
      <text>Input Test - Type something and press Enter:</text>
      <text>{'\n'}</text>
      <text>Current value: "{value}"</text>
      <text>{'\n\n'}</text>

      <input
        value={value}
        onInput={setValue}
        onSubmit={handleSubmit}
        placeholder="Type here..."
        focused={true}
      />

      <text>{'\n\n'}</text>
      <text dimColor>Press Ctrl+C to exit</text>
    </box>
  );
}

export async function main() {
  const renderer = await createCliRenderer();
  const root = createRoot(renderer);

  root.render(<TestApp />);

  return new Promise<void>(() => {});
}
