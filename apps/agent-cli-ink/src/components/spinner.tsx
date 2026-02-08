import React, { useEffect, useMemo, useState } from "react";
import { Text } from "ink";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface SpinnerDotProps {
  state: "running" | "success" | "error" | "idle";
  intervalMs?: number;
}

export function SpinnerDot({ state, intervalMs = 90 }: SpinnerDotProps): React.JSX.Element {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    if (state !== "running") return;

    const timer = setInterval(() => {
      setFrameIndex((value) => (value + 1) % FRAMES.length);
    }, intervalMs);

    return () => clearInterval(timer);
  }, [state, intervalMs]);

  const node = useMemo(() => {
    if (state === "success") return <Text color="green">⏺</Text>;
    if (state === "error") return <Text color="red">⏺</Text>;
    if (state === "running") return <Text color="gray">{FRAMES[frameIndex]}</Text>;
    return(<Text color="#f0f0f0">⏺</Text>);
  }, [state, frameIndex]);

  return node;
}
