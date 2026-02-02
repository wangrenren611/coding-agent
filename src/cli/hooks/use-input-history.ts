/**
 * Input History Hook
 *
 * 管理用户输入历史，支持上下键切换
 * 类似于 bash/zsh 的命令历史功能
 */

import { useState, useCallback, useRef } from 'react';

// =============================================================================
// 配置常量
// =============================================================================

/** 默认最大历史记录数 */
const DEFAULT_MAX_HISTORY = 100;

// =============================================================================
// Hook 接口
// =============================================================================

export interface UseInputHistoryOptions {
  /** 最大历史记录数（默认 100） */
  maxHistory?: number;
  /** 是否持久化到 localStorage（默认 false，Node.js 环境不支持） */
  persist?: boolean;
}

export interface UseInputHistoryReturn {
  /** 当前输入值 */
  inputValue: string;
  /** 设置输入值 */
  setInputValue: (value: string) => void;
  /** 提交当前输入到历史 */
  submitInput: (value: string) => void;
  /** 是否有上一条历史 */
  hasPrevious: boolean;
  /** 是否有下一条历史 */
  hasNext: boolean;
  /** 切换到上一条历史（↑ 键） */
  navigatePrevious: () => string | null;
  /** 切换到下一条历史（↓ 键） */
  navigateNext: () => string | null;
  /** 重置导航索引（当用户开始输入时调用） */
  resetNavigation: () => void;
  /** 清空历史 */
  clearHistory: () => void;
  /** 获取历史列表（用于调试） */
  getHistory: () => string[];
}

// =============================================================================
// Hook 实现
// =============================================================================

export function useInputHistory(options: UseInputHistoryOptions = {}): UseInputHistoryReturn {
  const { maxHistory = DEFAULT_MAX_HISTORY, persist = false } = options;

  // 历史记录列表
  const [history, setHistory] = useState<string[]>([]);

  // 当前输入值
  const [inputValue, setInputValue] = useState('');

  // 当前导航索引（-1 表示不在历史导航中，使用当前输入）
  // 0 表示最新的历史记录，history.length - 1 表示最旧的历史记录
  const [navIndex, setNavIndex] = useState(-1);

  // 保存用户正在输入的内容（临时存储，用于按 ↓ 键恢复）
  const draftRef = useRef<string>('');

  // 标记是否正在导航历史中
  const isNavigatingRef = useRef(false);

  // =============================================================================
  // 核心方法
  // =============================================================================

  /**
   * 提交输入到历史
   */
  const submitInput = useCallback((value: string) => {
    const trimmed = value.trim();

    // 忽略空字符串
    if (!trimmed) return;

    // 忽略重复的连续输入
    if (history.length > 0 && history[0] === trimmed) {
      // 重置导航状态
      setNavIndex(-1);
      draftRef.current = '';
      isNavigatingRef.current = false;
      return;
    }

    setHistory(prev => {
      const newHistory = [trimmed, ...prev].slice(0, maxHistory);
      return newHistory;
    });

    // 重置导航状态
    setNavIndex(-1);
    draftRef.current = '';
    isNavigatingRef.current = false;
  }, [history, maxHistory]);

  /**
   * 设置输入值（外部控制）
   */
  const handleSetInputValue = useCallback((value: string) => {
    setInputValue(value);

    // 如果用户手动输入，重置导航状态
    if (isNavigatingRef.current) {
      isNavigatingRef.current = false;
      setNavIndex(-1);
    }
  }, []);

  /**
   * 切换到上一条历史（↑ 键）
   * 返回新的输入值，如果没有上一条则返回 null
   */
  const navigatePrevious = useCallback((): string | null => {
    if (history.length === 0) return null;

    // 如果当前不在导航中，先保存当前草稿
    if (!isNavigatingRef.current) {
      draftRef.current = inputValue;
      isNavigatingRef.current = true;
    }

    // 计算新的索引
    // navIndex === -1 时，切换到 0（最新的历史）
    // navIndex >= 0 时，切换到更旧的历史（索引 +1）
    const newIndex = navIndex === -1 ? 0 : Math.min(navIndex + 1, history.length - 1);

    // 如果已经是最旧的了，不再改变
    if (newIndex === navIndex) {
      return history[newIndex];
    }

    setNavIndex(newIndex);
    const newValue = history[newIndex];
    setInputValue(newValue);
    return newValue;
  }, [history, navIndex, inputValue]);

  /**
   * 切换到下一条历史（↓ 键）
   * 返回新的输入值，如果没有下一条则返回 null
   */
  const navigateNext = useCallback((): string | null => {
    if (!isNavigatingRef.current || navIndex === -1) {
      return null;
    }

    // 计算新的索引
    // navIndex === 0 时，退出导航，恢复草稿（navIndex = -1）
    // navIndex > 0 时，切换到更新的历史（索引 -1）
    if (navIndex === 0) {
      setNavIndex(-1);
      isNavigatingRef.current = false;
      setInputValue(draftRef.current);
      return draftRef.current;
    }

    const newIndex = navIndex - 1;
    setNavIndex(newIndex);
    const newValue = history[newIndex];
    setInputValue(newValue);
    return newValue;
  }, [history, navIndex]);

  /**
   * 重置导航索引
   * 当用户开始输入时调用
   */
  const resetNavigation = useCallback(() => {
    setNavIndex(-1);
    isNavigatingRef.current = false;
    draftRef.current = '';
  }, []);

  /**
   * 清空历史
   */
  const clearHistory = useCallback(() => {
    setHistory([]);
    setNavIndex(-1);
    draftRef.current = '';
    isNavigatingRef.current = false;
  }, []);

  /**
   * 获取历史列表（用于调试）
   */
  const getHistory = useCallback(() => {
    return [...history];
  }, [history]);

  // =============================================================================
  // 计算属性
  // =============================================================================

  const hasPrevious = history.length > 0 && (navIndex === -1 || navIndex < history.length - 1);
  const hasNext = isNavigatingRef.current && navIndex >= 0;

  return {
    inputValue,
    setInputValue: handleSetInputValue,
    submitInput,
    hasPrevious,
    hasNext,
    navigatePrevious,
    navigateNext,
    resetNavigation,
    clearHistory,
    getHistory,
  };
}

export default useInputHistory;
