import type { ComponentType } from 'react';

/** 幻灯片组件类型 */
export type SlideComponent = ComponentType;

/** 导航项 */
export interface NavItem {
  /** 幻灯片索引 */
  slideIndex: number;
  /** 显示标签 */
  label: string;
}

/** 背景变体类型 */
export type BackgroundVariant = 'glow' | 'grid' | 'mesh' | 'minimal';

/** 过渡动画变体 */
export type TransitionVariant = 'fade' | 'slide' | 'scale' | 'slideUp' | 'elegant';

/** 滑动方向 */
export type SlideDirection = 1 | -1 | 0;

/** 幻灯片过渡配置 */
export interface SlideTransitionConfig {
  type: 'spring' | 'tween';
  stiffness?: number;
  damping?: number;
  duration?: number;
}

/** 动画变体定义 - 兼容 framer-motion */
export interface AnimationVariant {
  initial: Record<string, number | string>;
  animate: Record<string, number | string>;
  exit: Record<string, number | string>;
  [key: string]: unknown;
}

/** 导航组件属性 */
export interface NavigationProps {
  /** 当前幻灯片索引 */
  currentSlide: number;
  /** 幻灯片总数 */
  totalSlides: number;
  /** 导航项列表 */
  navItems: NavItem[];
  /** 上一页回调 */
  onPrev: () => void;
  /** 下一页回调 */
  onNext: () => void;
  /** 跳转回调 */
  onGoTo: (index: number) => void;
}

/** 背景组件属性 */
export interface BackgroundProps {
  /** 背景变体 */
  variant?: BackgroundVariant;
  /** 是否启用动画 */
  animate?: boolean;
  /** 自定义类名 */
  className?: string;
}

/** 幻灯片过渡组件属性 */
export interface SlideTransitionProps {
  /** 子元素 */
  children: React.ReactNode;
  /** 幻灯片唯一标识 */
  slideKey: string | number;
  /** 过渡变体 */
  variant?: TransitionVariant;
  /** 自定义类名 */
  className?: string;
}

/** 动画组件通用属性 */
export interface AnimationProps {
  /** 子元素 */
  children: React.ReactNode;
  /** 延迟时间（秒） */
  delay?: number;
  /** 自定义类名 */
  className?: string;
}

/** 滑入方向 */
export type SlideInDirection = 'up' | 'down' | 'left' | 'right';

/** 滑入组件属性 */
export interface SlideInProps extends AnimationProps {
  /** 滑入方向 */
  direction?: SlideInDirection;
}

/** 悬停缩放组件属性 */
export interface HoverScaleProps {
  /** 子元素 */
  children: React.ReactNode;
  /** 缩放比例 */
  scale?: number;
  /** 自定义类名 */
  className?: string;
}

/** stagger 动画配置 */
export interface StaggerConfig {
  /** 子元素间延迟 */
  staggerChildren?: number;
  /** 初始延迟 */
  delayChildren?: number;
}

/** stagger 动画返回类型 */
export interface StaggerAnimation {
  /** 容器变体 */
  container: {
    hidden: Record<string, number>;
    show: {
      opacity: number;
      transition: StaggerConfig;
    };
  };
  /** 子项变体 */
  item: {
    hidden: Record<string, number>;
    show: {
      opacity: number;
      y: number;
      transition: {
        type: 'spring';
        damping: number;
        stiffness: number;
      };
    };
  };
}
