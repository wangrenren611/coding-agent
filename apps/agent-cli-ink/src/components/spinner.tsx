import React, { useEffect, useMemo, useState } from "react";
import { Text } from "ink";

const FRAMES = ["-", "\\", "|", "/"];

export interface SpinnerDotProps {
  state: "running" | "success" | "error" | "idle";
  intervalMs?: number;
  animate?: boolean;
}

export function SpinnerDot({ state, intervalMs = 90, animate = true }: SpinnerDotProps): React.JSX.Element {
  const [frameIndex, setFrameIndex] = useState(0);
  const shouldAnimate = state === "running" && animate;

  useEffect(() => {
    if (!shouldAnimate) return;

    const timer = setInterval(() => {
      setFrameIndex((value) => (value + 1) % FRAMES.length);
    }, intervalMs);

    return () => clearInterval(timer);
  }, [shouldAnimate, intervalMs]);

  useEffect(() => {
    if (!shouldAnimate) setFrameIndex(0);
  }, [shouldAnimate]);

  const node = useMemo(() => {
    if (state === "success") return <Text color="green">o</Text>;
    if (state === "error") return <Text color="red">x</Text>;
    if (state === "running") return <Text color="#999">{shouldAnimate ? FRAMES[frameIndex] : "."}</Text>;
    return <Text color="#999">.</Text>;
  }, [state, frameIndex, shouldAnimate]);

  return node;
}
