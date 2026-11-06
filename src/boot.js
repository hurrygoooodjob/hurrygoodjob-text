/* Local-only, dependency-free CRT intro. The controller can be reused independently. */
(function () {
  'use strict';

  class BootSequence {
    constructor(element, { duration = 1800 } = {}) {
      this.element = element;
      this.duration = Math.max(0, duration);
      this.lines = [...element.querySelectorAll('[data-boot-line]')];
      this.status = element.querySelector('[data-boot-status]');
      this.progress = element.querySelector('[data-boot-progress]');
      this.skipButton = element.querySelector('[data-boot-skip]');
      this.motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.timers = new Set();
      this.animation = null;
      this.running = false;
      this.destroyed = false;
      this.onSkip = () => this.finish('skipped');
      this.onMotionChange = event => { if (event.matches) this.finish('reduced-motion'); };
      this.onVisibilityChange = () => { if (document.hidden) this.finish('hidden'); };
      this.skipButton.addEventListener('click', this.onSkip);
      this.motionPreference.addEventListener('change', this.onMotionChange);
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }

    /** Resolves with { reason }; commit the decoded image before calling play(). */
    play() {
      this.cancel();
      if (this.destroyed) return Promise.resolve({ reason: 'destroyed' });
      if (this.motionPreference.matches || document.hidden || !this.duration) {
        return Promise.resolve({ reason: this.motionPreference.matches ? 'reduced-motion' : 'hidden' });
      }
      this.running = true;
      this.returnFocus = document.activeElement;
      this.element.hidden = false;
      this.element.classList.remove('is-running');
      this.lines.forEach(line => line.classList.remove('is-visible'));
      this.status.textContent = 'INITIALIZING DISPLAY';
      this.progress.style.transform = 'scaleX(0)';
      // Restart the one-pass sweep when replaying the same DOM element.
      void this.element.offsetWidth;
      this.element.classList.add('is-running');
      this.skipButton.focus({ preventScroll: true });
      const promise = new Promise(resolve => { this.resolve = resolve; });
      this.lines[0]?.classList.add('is-visible');
      this.after(this.duration * .24, () => this.lines[1]?.classList.add('is-visible'));
      this.after(this.duration * .76, () => { this.status.textContent = 'READY'; });
      this.after(this.duration, () => this.finish('complete'));
      if (typeof this.progress.animate === 'function') {
        this.animation = this.progress.animate(
          [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
          { duration: this.duration * .88, easing: 'cubic-bezier(.2,.4,.4,1)', fill: 'forwards' }
        );
      } else {
        this.progress.style.transform = 'scaleX(1)';
      }
      return promise;
    }

    after(delay, callback) {
      const timer = window.setTimeout(() => {
        this.timers.delete(timer);
        if (this.running) callback();
      }, delay);
      this.timers.add(timer);
    }

    finish(reason) {
      const shouldRestoreFocus = this.running && document.activeElement === this.skipButton;
      this.timers.forEach(timer => window.clearTimeout(timer));
      this.timers.clear();
      this.animation?.cancel();
      this.animation = null;
      this.element.classList.remove('is-running');
      this.element.hidden = true;
      const wasRunning = this.running;
      this.running = false;
      if (wasRunning && shouldRestoreFocus && this.returnFocus?.isConnected) {
        const visible = !this.returnFocus.getClientRects || this.returnFocus.getClientRects().length > 0;
        const target = visible && !this.returnFocus.disabled ? this.returnFocus : document.querySelector?.('[data-boot-return-focus]');
        target?.focus({ preventScroll: true });
      }
      const resolve = this.resolve;
      this.resolve = null;
      resolve?.({ reason });
    }

    skip() { this.finish('skipped'); }
    cancel() { this.finish('cancelled'); }

    destroy() {
      this.cancel();
      this.destroyed = true;
      this.skipButton.removeEventListener('click', this.onSkip);
      this.motionPreference.removeEventListener('change', this.onMotionChange);
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  window.BootSequence = BootSequence;

})();
