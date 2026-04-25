/**
 * Source Output Monitor - Debug Tool
 *
 * 实时显示 Source 模块的原始波形输出值（-1 到 1）
 *
 * 启用/禁用：修改下面的 ENABLED 常量
 */

// ==================== 配置开关 ====================
export const ENABLED = false; // <-- 设置为 true 启用，false 禁用

// ==================== 监控器类 ====================
export class SourceOutputMonitor {
  constructor(app) {
    this.app = app;
    this.running = false;
    this.frameId = 0;
  }

  start() {
    if (!ENABLED || this.running) return;
    this.running = true;
    this.tick();
  }

  stop() {
    this.running = false;
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = 0;
    }
  }

  tick() {
    if (!this.running) return;
    this.update();
    this.frameId = requestAnimationFrame(() => this.tick());
  }

  getLevelClass(value) {
    if (value > 0) {
      if (value > 0.8) return "output-level--high-positive";
      if (value > 0.5) return "output-level--medium-positive";
      if (value > 0.1) return "output-level--low-positive";
      return "output-level--near-zero";
    } else {
      if (value < -0.8) return "output-level--high-negative";
      if (value < -0.5) return "output-level--medium-negative";
      if (value < -0.1) return "output-level--low-negative";
      return "output-level--near-zero";
    }
  }

  update() {
    const app = this.app;
    if (!app.engine?.ready) return;

    const CHAIN_COUNT = 4;

    for (let chainIndex = 0; chainIndex < CHAIN_COUNT; chainIndex++) {
      const chain = app.getChain(chainIndex);
      if (!chain?.enabled || !chain.modules?.length) continue;

      chain.modules.forEach((module) => {
        if (module.category !== "source") return;

        const runtime = app.engine.getModuleRuntime(chainIndex, module.id);
        if (!runtime?.getOutputValue) return;

        const value = runtime.getOutputValue();
        const displayValue = value.toFixed(3);

        if (chainIndex === app.getSelectedChainIndex()) {
          const card = app.elements.signalFlow?.querySelector(
            `[data-module-id="${module.id}"]`
          );
          if (card?.outputLevelDisplay) {
            card.outputLevelDisplay.textContent = displayValue;
            card.outputLevelDisplay.className = `module-output-level ${this.getLevelClass(value)}`;
          }
        }
      });
    }
  }
}
