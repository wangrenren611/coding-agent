import type { SlideTransitionConfig } from '@/types';
import type { Variants } from 'framer-motion';

/** 幻灯片过渡动画变体 */
export const SLIDE_VARIANTS = {
  enter: (direction: number) => ({
    x: direction > 0 ? 300 : -300,
    opacity: 0,
    scale: 0.95,
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 300 : -300,
    opacity: 0,
    scale: 0.95,
  }),
} as const;

/** 幻灯片过渡配置 */
export const SLIDE_TRANSITION: SlideTransitionConfig = {
  type: 'spring',
  stiffness: 300,
  damping: 30,
} as const;

/** 页面过渡动画变体 */
export const PAGE_TRANSITION_VARIANTS: Record<string, Variants> = {
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  },
  slide: {
    initial: { opacity: 0, x: 100 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -100 },
  },
  scale: {
    initial: { opacity: 0, scale: 0.95 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 1.05 },
  },
  slideUp: {
    initial: { opacity: 0, y: 30 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -30 },
  },
  elegant: {
    initial: { opacity: 0, scale: 0.98, y: 10 },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.98, y: -10 },
  },
} as const;

/** 默认过渡配置 */
export const DEFAULT_TRANSITION_CONFIG: SlideTransitionConfig = {
  type: 'spring',
  damping: 30,
  stiffness: 300,
} as const;

/** 键盘快捷键 */
export const KEYBOARD_SHORTCUTS: {
  next: string[];
  prev: string[];
  closeMenu: string[];
} = {
  /** 下一页 */
  next: ['ArrowRight', 'ArrowDown', ' '],
  /** 上一页 */
  prev: ['ArrowLeft', 'ArrowUp'],
  /** 关闭菜单 */
  closeMenu: ['Escape'],
} as const;

/** 动画时长（秒） */
export const ANIMATION_DURATION = {
  fast: 0.3,
  normal: 0.5,
  slow: 0.8,
} as const;

/** 延迟时间（秒） */
export const ANIMATION_DELAY = {
  stagger: 0.1,
  staggerChildren: 0.2,
} as const;

/** 弹簧动画配置 */
export const SPRING_CONFIG = {
  default: { type: 'spring' as const, damping: 25, stiffness: 300 },
  soft: { type: 'spring' as const, damping: 30, stiffness: 200 },
  bouncy: { type: 'spring' as const, damping: 15, stiffness: 400 },
} as const;

/** 默认缩放比例 */
export const DEFAULT_HOVER_SCALE = 1.02;

/** 方向映射 */
export const DIRECTION_MAP = {
  up: { y: 30 },
  down: { y: -30 },
  left: { x: 30 },
  right: { x: -30 },
} as const;
