import { AnimatePresence, motion } from 'framer-motion';
import Navigation from './components/Navigation';
import Background from './components/Background';
import { useSlideNavigation } from './hooks';
import { SLIDE_VARIANTS, SLIDE_TRANSITION } from './constants';
import type { SlideComponent, NavItem } from './types';

// Slides will be imported here by the main agent
// Example: import Slide01 from './slides/01-hero';
// const SLIDES: SlideComponent[] = [Slide01, Slide02, ...];
// const NAV_ITEMS: NavItem[] = [{ slideIndex: 0, label: 'Hero' }, ...];

// Placeholder - will be replaced during generation
const SLIDES: SlideComponent[] = [];
const NAV_ITEMS: NavItem[] = [];

/**
 * 应用主组件
 * 管理幻灯片状态和导航
 */
export default function App() {
  const {
    currentSlide,
    direction,
    goToSlide,
    nextSlide,
    prevSlide,
  } = useSlideNavigation({
    totalSlides: SLIDES.length,
  });

  // 空状态
  if (SLIDES.length === 0) {
    return (
      <div className="h-screen w-screen bg-bg-base flex items-center justify-center relative overflow-hidden">
        <Background variant="glow" />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center z-10"
        >
          <p className="text-xl mb-2 text-text-primary">No slides yet</p>
          <p className="text-sm text-text-muted">Slides will be generated here</p>
        </motion.div>
      </div>
    );
  }

  const CurrentSlideComponent = SLIDES[currentSlide];

  return (
    <div className="h-screen w-screen bg-bg-base overflow-hidden relative">
      {/* Decorative Background */}
      <Background variant="glow" animate={true} />

      {/* Slide Content */}
      <main className="relative h-full w-full z-10">
        <AnimatePresence initial={false} custom={direction} mode="wait">
          <motion.div
            key={currentSlide}
            custom={direction}
            variants={SLIDE_VARIANTS}
            initial="enter"
            animate="center"
            exit="exit"
            transition={SLIDE_TRANSITION}
            className="absolute inset-0 h-full w-full"
          >
            <CurrentSlideComponent />
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Navigation */}
      <Navigation
        currentSlide={currentSlide}
        totalSlides={SLIDES.length}
        navItems={NAV_ITEMS}
        onPrev={prevSlide}
        onNext={nextSlide}
        onGoTo={goToSlide}
      />
    </div>
  );
}
