import { motion, AnimatePresence } from 'framer-motion';
import type {
  SlideTransitionProps,
  AnimationProps,
  SlideInProps,
  HoverScaleProps,
  StaggerAnimation,
} from '@/types';
import {
  PAGE_TRANSITION_VARIANTS,
  DEFAULT_TRANSITION_CONFIG,
  DIRECTION_MAP,
  DEFAULT_HOVER_SCALE,
} from '@/constants';

/**
 * 幻灯片过渡包装组件
 * 提供页面切换动画效果
 */
export default function SlideTransition({
  children,
  slideKey,
  variant = 'elegant',
  className = '',
}: SlideTransitionProps) {
  const selectedVariant =
    PAGE_TRANSITION_VARIANTS[variant] ?? PAGE_TRANSITION_VARIANTS.elegant;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={slideKey}
        initial="initial"
        animate="animate"
        exit="exit"
        variants={selectedVariant}
        transition={DEFAULT_TRANSITION_CONFIG}
        className={`h-full w-full ${className}`}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * 淡入动画组件
 */
export function FadeIn({
  children,
  delay = 0,
  className = '',
}: AnimationProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * 滑入动画组件
 */
export function SlideIn({
  children,
  delay = 0,
  direction = 'up',
  className = '',
}: SlideInProps) {
  const initialPosition = DIRECTION_MAP[direction] ?? DIRECTION_MAP.up;

  return (
    <motion.div
      initial={{ opacity: 0, ...initialPosition }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{
        type: 'spring',
        damping: 25,
        stiffness: 300,
        delay,
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * 缩放入场动画组件
 */
export function ScaleIn({
  children,
  delay = 0,
  className = '',
}: AnimationProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{
        type: 'spring',
        damping: 25,
        stiffness: 300,
        delay,
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * Stagger 动画容器
 * 子元素将依次动画显示
 */
export function StaggerContainer({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{
        hidden: { opacity: 0 },
        show: {
          opacity: 1,
          transition: { staggerChildren: 0.1, delayChildren: 0.2 },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * Stagger 动画子项
 * 需要作为 StaggerContainer 的直接子元素使用
 */
export function StaggerItem({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 20 },
        show: {
          opacity: 1,
          y: 0,
          transition: { type: 'spring', damping: 25, stiffness: 300 },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * 悬停缩放包装组件
 */
export function HoverScale({
  children,
  scale = DEFAULT_HOVER_SCALE,
  className = '',
}: HoverScaleProps) {
  return (
    <motion.div
      whileHover={{
        scale,
        transition: { type: 'spring', stiffness: 400, damping: 25 },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * Stagger 动画 Hook
 * @param delay - 子元素间延迟（秒）
 * @returns 容器和子项的变体配置
 */
export function useStaggerAnimation(delay: number = 0.1): StaggerAnimation {
  return {
    container: {
      hidden: { opacity: 0 },
      show: {
        opacity: 1,
        transition: {
          staggerChildren: delay,
          delayChildren: 0.2,
        },
      },
    },
    item: {
      hidden: { opacity: 0, y: 20 },
      show: {
        opacity: 1,
        y: 0,
        transition: {
          type: 'spring',
          damping: 25,
          stiffness: 300,
        },
      },
    },
  };
}
