import { useState, useCallback } from 'react';
import type { SlideDirection } from '@/types';

interface UseSlideNavigationOptions {
  /** 幻灯片总数 */
  totalSlides: number;
  /** 初始幻灯片索引 */
  initialSlide?: number;
}

interface UseSlideNavigationReturn {
  /** 当前幻灯片索引 */
  currentSlide: number;
  /** 滑动方向 */
  direction: SlideDirection;
  /** 跳转到指定幻灯片 */
  goToSlide: (index: number) => void;
  /** 下一页 */
  nextSlide: () => void;
  /** 上一页 */
  prevSlide: () => void;
  /** 是否可以前进 */
  canGoNext: boolean;
  /** 是否可以后退 */
  canGoPrev: boolean;
}

/**
 * 幻灯片导航 Hook
 * 管理幻灯片状态和导航逻辑
 */
export function useSlideNavigation({
  totalSlides,
  initialSlide = 0,
}: UseSlideNavigationOptions): UseSlideNavigationReturn {
  const [currentSlide, setCurrentSlide] = useState(initialSlide);
  const [direction, setDirection] = useState<SlideDirection>(0);

  const canGoNext = currentSlide < totalSlides - 1;
  const canGoPrev = currentSlide > 0;

  const goToSlide = useCallback(
    (index: number) => {
      if (index < 0 || index >= totalSlides || index === currentSlide) {
        return;
      }
      setDirection(index > currentSlide ? 1 : -1);
      setCurrentSlide(index);
    },
    [currentSlide, totalSlides]
  );

  const nextSlide = useCallback(() => {
    if (canGoNext) {
      setDirection(1);
      setCurrentSlide((prev) => prev + 1);
    }
  }, [canGoNext]);

  const prevSlide = useCallback(() => {
    if (canGoPrev) {
      setDirection(-1);
      setCurrentSlide((prev) => prev - 1);
    }
  }, [canGoPrev]);

  return {
    currentSlide,
    direction,
    goToSlide,
    nextSlide,
    prevSlide,
    canGoNext,
    canGoPrev,
  };
}
