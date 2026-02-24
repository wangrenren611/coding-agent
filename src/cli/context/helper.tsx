/** @jsxImportSource @opentui/react */
/**
 * Context helper - 简化 Context 创建
 */
import { createContext, useContext, type ReactNode, createElement } from "react";

export interface SimpleContext<T> {
  Provider: (props: { children: ReactNode }) => ReactNode;
  use: () => T;
}

export function createSimpleContext<T>(
  name: string,
  init: () => T
): SimpleContext<T> {
  const ctx = createContext<T | null>(null);

  const Provider = (props: { children: ReactNode }): ReactNode => {
    const value = init();
    return createElement(ctx.Provider, { value }, props.children);
  };

  const use = (): T => {
    const value = useContext(ctx);
    if (!value) {
      throw new Error(`${name} context must be used within provider`);
    }
    return value;
  };

  return { Provider, use };
}
