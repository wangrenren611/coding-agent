import React from 'react';
import { motion } from 'framer-motion';
import { Code2, Sparkles, Calendar, User, Layers } from 'lucide-react';

export default function HeroSlide() {
  return (
    <div className="slide-page relative overflow-hidden">
      {/* Background gradient orbs */}
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-primary-600/20 blur-3xl"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.5, 0.3],
          }}
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
        <motion.div
          className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-accent-600/20 blur-3xl"
          animate={{
            scale: [1.2, 1, 1.2],
            opacity: [0.3, 0.5, 0.3],
          }}
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      </div>

      <div className="slide-content relative z-10 flex flex-col justify-center">
        {/* Main title section */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="mb-12"
        >
          {/* Icon badge */}
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ duration: 0.6, delay: 0.2, type: 'spring', stiffness: 200 }}
            className="inline-flex items-center justify-center w-16 h-16 mb-6 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 shadow-lg"
          >
            <Code2 className="w-8 h-8 text-accent-400" />
          </motion.div>

          {/* Title */}
          <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-primary-300 via-accent-300 to-primary-300 bg-clip-text text-transparent">
            Coding Agent 核心架构解析
          </h1>

          {/* Subtitle */}
          <p className="text-2xl text-secondary font-light">
            基于协调器模式的生产级 AI 编码助手
          </p>
        </motion.div>

        {/* Info cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4, ease: 'easeOut' }}
          className="flex flex-wrap gap-4"
        >
          {/* Speaker card */}
          <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-white/10 backdrop-blur-md border border-white/20 shadow-lg">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary-500/20">
              <User className="w-5 h-5 text-primary-300" />
            </div>
            <div>
              <p className="text-xs text-muted uppercase tracking-wider">演讲者</p>
              <p className="text-sm font-medium text-primary-100">Coding Agent 开发团队</p>
            </div>
          </div>

          {/* Date card */}
          <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-white/10 backdrop-blur-md border border-white/20 shadow-lg">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-accent-500/20">
              <Calendar className="w-5 h-5 text-accent-300" />
            </div>
            <div>
              <p className="text-xs text-muted uppercase tracking-wider">日期</p>
              <p className="text-sm font-medium text-accent-100">2026 年 2 月</p>
            </div>
          </div>

          {/* Tech stack card */}
          <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-white/10 backdrop-blur-md border border-white/20 shadow-lg">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary-500/20">
              <Layers className="w-5 h-5 text-primary-300" />
            </div>
            <div>
              <p className="text-xs text-muted uppercase tracking-wider">技术栈</p>
              <p className="text-sm font-medium text-primary-100 line-clamp-2">
                TypeScript + Node.js + 多 Provider 支持
              </p>
            </div>
          </div>
        </motion.div>

        {/* Decorative sparkle */}
        <motion.div
          className="absolute top-1/4 right-1/4"
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.8 }}
        >
          <Sparkles className="w-6 h-6 text-accent-400/60" />
        </motion.div>
      </div>
    </div>
  );
}
