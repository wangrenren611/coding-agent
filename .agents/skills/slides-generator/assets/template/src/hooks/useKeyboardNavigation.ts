import { useEffect, useCallback } from 'react';
import { KEYBOARD_SHORTCUTS } from '@/constants';

interface UseKeyboardNavigationOptions {
  /** 下一页回调 */
  onNext: () => void;
  /** 上一页回调 */
  onPrev: () => void;
  /** 关闭菜单回调（可选） */
  onCloseMenu?: () => void;
  /** 是否启用 */
  enabled?: boolean;
}

/**
 * 键盘导航 Hook
 * 处理左右箭头、上下箭头和空格键的导航
 */
export function useKeyboardNavigation({
  onNext,
  onPrev,
  onCloseMenu,
  enabled = true,
}: UseKeyboardNavigationOptions): void {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      const { key } = event;

      // 下一页
      if (KEYBOARD_SHORTCUTS.next.includes(key)) {
        event.preventDefault();
        onNext();
        return;
      }

      // 上一页
      if (KEYBOARD_SHORTCUTS.prev.includes(key)) {
        event.preventDefault();
        onPrev();
        return;
      }

      // 关闭菜单
      if (KEYBOARD_SHORTCUTS.closeMenu.includes(key) && onCloseMenu) {
        event.preventDefault();
        onCloseMenu();
      }
    },
    [enabled, onNext, onPrev, onCloseMenu]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
