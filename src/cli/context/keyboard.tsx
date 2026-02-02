/**
 * Keyboard Management Context
 *
 * 管理多个 useInput 监听器，避免冲突
 * 提供统一的键盘事件处理机制
 */

import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  type ReactNode
} from 'react';
import { useInput } from 'ink';

/**
 * 应用模式 - 状态机
 * 定义应用的不同状态，用于控制键盘处理器的激活
 */
export type AppMode =
  | 'idle'            // 空闲状态
  | 'typing'          // 输入消息
  | 'commandSelect'   // 选择命令
  | 'confirmExit'     // 确认退出
  | 'page-init'       // /init 命令页
  | 'page-help'       // /help 命令页
  | 'page-model-select' // /model-select 命令页
  | 'page-settings'   // /settings 命令页
  | 'page-memory'     // /memory 命令页
  | 'page-history'    // /history 命令页
  | 'page-session'    // /session 命令页
  | 'page-new-session' // /new-session 命令页
  | 'page-delete-session' // /delete-session 命令页
  | 'page-list-sessions' // /list-sessions 命令页
  | 'page-export'     // /export 命令页
  | 'page-import'     // /import 命令页
  | 'page-config'     // /config 命令页
  | 'page-version'    // /version 命令页
  | 'page-about'      // /about 命令页
  | 'page-debug'      // /debug 命令页
  | 'page-status'     // /status 命令页
  | 'page-reset';     // /reset 命令页

/**
 * 键盘事件信息
 * 包含输入字符和按键状态
 */
export interface KeyboardEvent {
  /** 用户输入的字符 */
  input: string;
  /** 按键状态对象（扩展了 Ink 的 Key 类型）*/
  key: {
    /** 上箭头 */
    upArrow: boolean;
    /** 下箭头 */
    downArrow: boolean;
    /** 左箭头 */
    leftArrow: boolean;
    /** 右箭头 */
    rightArrow: boolean;
    /** 回车键 */
    return: boolean;
    /** ESC 键 */
    escape: boolean;
    /** Ctrl 键 */
    ctrl: boolean;
    /** Shift 键 */
    shift: boolean;
    /** Tab 键 */
    tab: boolean;
    /** 退格键 */
    backspace: boolean;
    /** Delete 键 */
    delete: boolean;
    /** Page Up */
    pageUp: boolean;
    /** Page Down */
    pageDown: boolean;
    /** Home 键（可选支持）*/
    home?: boolean;
    /** End 键（可选支持）*/
    end?: boolean;
    /** Meta/Win/Command 键 */
    meta: boolean;
  };
}

/**
 * 键盘处理器类型
 *
 * @param event - 键盘事件对象
 * @returns boolean - 返回 true 表示事件已处理，停止传播；返回 false 或 undefined 表示未处理，继续传播
 */
export type KeyboardHandler = (event: KeyboardEvent) => boolean | void;

/**
 * 优先级级别
 * 数字越小，优先级越高
 */
export enum HandlerPriority {
  /** 全局处理器（Ctrl+C, Q 等系统快捷键）*/
  GLOBAL = 0,
  /** 关键处理器（退出确认等）*/
  CRITICAL = 10,
  /** 模态框（选择器、对话框）*/
  MODAL = 20,
  /** 导航（菜单、列表）*/
  NAVIGATION = 30,
  /** 普通输入 */
  INPUT = 40,
}

/**
 * 注册的处理器配置
 */
interface RegisteredHandler {
  /** 处理器唯一标识 */
  id: string;
  /** 优先级 */
  priority: HandlerPriority;
  /** 激活的模式列表 */
  activeModes: AppMode[];
  /** 处理函数 */
  handler: KeyboardHandler;
}

/**
 * 键盘管理上下文值
 */
interface KeyboardContextValue {
  /** 当前应用模式 */
  mode: AppMode;
  /** 设置应用模式 */
  setMode: (mode: AppMode) => void;
  /**
   * 注册键盘处理器
   */
  registerHandler: (config: {
    id: string;
    priority: HandlerPriority;
    activeModes: AppMode[];
    handler: KeyboardHandler;
  }) => () => void;
  /**
   * 检查处理器是否激活
   */
  isHandlerActive: (id: string) => boolean;
}

/**
 * 键盘管理上下文
 */
const KeyboardContext = createContext<KeyboardContextValue | null>(null);

/**
 * 键盘管理器 Provider 组件
 *
 * 应该在应用的根部使用，提供统一的键盘事件管理
 */
export const KeyboardManager: React.FC<{
  /** 子组件 */
  children: ReactNode;
  /** 退出回调（可选）*/
  onExit?: () => void;
}> = ({ children, onExit }) => {
  const [mode, setMode] = useState<AppMode>('idle');
  const handlersRef = useRef<Map<string, RegisteredHandler>>(new Map());

  /**
   * 注册处理器
   */
  const registerHandler = useCallback((config: {
    id: string;
    priority: HandlerPriority;
    activeModes: AppMode[];
    handler: KeyboardHandler;
  }) => {
    const handler: RegisteredHandler = config;
    handlersRef.current.set(config.id, handler);

    // 返回取消注册函数
    return () => {
      handlersRef.current.delete(config.id);
    };
  }, []);

  /**
   * 检查处理器是否激活
   */
  const isHandlerActive = useCallback((id: string): boolean => {
    const handler = handlersRef.current.get(id);
    if (!handler) return false;
    return handler.activeModes.includes(mode);
  }, [mode]);

  /**
   * 全局键盘处理
   * 单一入口，按优先级分发
   */
  useInput((input, key) => {
    // 构建键盘事件对象
    const event: KeyboardEvent = { input, key };

    // 获取所有在当前模式下激活的处理器
    const activeHandlers = Array.from(handlersRef.current.values())
      .filter(handler => handler.activeModes.includes(mode))
      .sort((a, b) => a.priority - b.priority);  // 按优先级排序

    // 按优先级依次调用处理器
    for (const handlerConfig of activeHandlers) {
      const handled = handlerConfig.handler(event);
      if (handled === true) {
        // 处理器返回 true 表示已处理，停止传播
        return;
      }
    }
  }, {
    isActive: true  // 始终激活，由处理器内部判断
  });

  const contextValue: KeyboardContextValue = {
    mode,
    setMode,
    registerHandler,
    isHandlerActive
  };

  return (
    <KeyboardContext.Provider value={contextValue}>
      {children}
    </KeyboardContext.Provider>
  );
};

/**
 * 使用键盘管理器的 Hook
 */
export const useKeyboard = () => {
  const context = useContext(KeyboardContext);
  if (!context) {
    throw new Error('useKeyboard must be used within KeyboardManager');
  }
  return context;
};

/**
 * 注册全局键盘处理器的 Hook
 */
export const useGlobalKeyboard = (config: {
  id: string;
  priority: HandlerPriority;
  activeModes: AppMode[];
  handler: KeyboardHandler;
}) => {
  const { registerHandler } = useKeyboard();

  React.useEffect(() => {
    const unregister = registerHandler(config);
    return unregister;
  }, [config.id, config.priority, config.activeModes, config.handler, registerHandler]);
};

/**
 * 快捷键匹配辅助函数
 */
export const isKeyMatch = (
  event: KeyboardEvent,
  pattern: {
    input?: string;
    ctrl?: boolean;
    shift?: boolean;
    meta?: boolean;
    escape?: boolean;
    return?: boolean;
    upArrow?: boolean;
    downArrow?: boolean;
    leftArrow?: boolean;
    rightArrow?: boolean;
  }
): boolean => {
  if (pattern.input !== undefined && event.input !== pattern.input) return false;
  if (pattern.ctrl !== undefined && event.key.ctrl !== pattern.ctrl) return false;
  if (pattern.shift !== undefined && event.key.shift !== pattern.shift) return false;
  if (pattern.meta !== undefined && event.key.meta !== pattern.meta) return false;
  if (pattern.escape !== undefined && event.key.escape !== pattern.escape) return false;
  if (pattern.return !== undefined && event.key.return !== pattern.return) return false;
  if (pattern.upArrow !== undefined && event.key.upArrow !== pattern.upArrow) return false;
  if (pattern.downArrow !== undefined && event.key.downArrow !== pattern.downArrow) return false;
  if (pattern.leftArrow !== undefined && event.key.leftArrow !== pattern.leftArrow) return false;
  if (pattern.rightArrow !== undefined && event.key.rightArrow !== pattern.rightArrow) return false;

  return true;
};

/**
 * 预定义的全局快捷键处理器 Hook
 */
export const useGlobalShortcuts = (onExit: () => void) => {
  useGlobalKeyboard({
    id: 'global-exit',
    priority: HandlerPriority.GLOBAL,
    activeModes: ['idle', 'typing', 'commandSelect', 'confirmExit'],
    handler: ({ input, key }) => {
      // Ctrl+C 或 Q - 始终退出
      if ((input === 'c' && key.ctrl) || input === 'q') {
        onExit();
        return true;
      }
      return false;
    }
  });
};
