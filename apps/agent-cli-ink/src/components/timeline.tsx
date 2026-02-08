import React from "react";
import { Box } from "ink";
import type { TimelineEntry } from "../types";
import { TimelineItem } from "./timeline-item";

export function Timeline({ entries }: { entries: TimelineEntry[] }): React.JSX.Element {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {entries.map((entry) => (
        <TimelineItem key={entry.id} entry={entry} />
      ))}
    </Box>
  );
}
