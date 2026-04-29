/**
 * Source Output Monitor - Debug Tool
 */

// ==================== Config ====================
export const ENABLED = false; // <-- set to true to enable

// ==================== Monitor Class ====================
export class SourceOutputMonitor {
  app: Record<string, unknown>;
  running: boolean;
  frameId: number;

  constructor(app: Record<string, unknown>) {
    this.app = app;
    this.running = false;
    this.frameId = 0;
  }

  start(): void {
    if (!ENABLED || this.running) return;
    this.running = true;
    this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = 0;
    }
  }

  tick(): void {
    if (!this.running) return;
    this.update();
    this.frameId = requestAnimationFrame(() => this.tick());
  }

  getLevelClass(value: number): string {
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

  update(): void {
    const app = this.app;
    const engine = app.engine as unknown as Record<string, unknown> | undefined;
    if (!engine?.ready) return;

    const CHAIN_COUNT = 4;
    const getChain = app.getChain as (index: number) => { enabled: boolean; modules: Array<{ category: string; id: string }> } | null;
    const getSelectedChainIndex = app.getSelectedChainIndex as () => number;
    const getModuleRuntime = engine.getModuleRuntime as (chainIndex: number, moduleId: string) => { getOutputValue?: () => number } | null;
    const signalFlow = (app.elements as unknown as Record<string, unknown>)?.signalFlow as HTMLElement | undefined;

    for (let chainIndex = 0; chainIndex < CHAIN_COUNT; chainIndex++) {
      const chain = getChain(chainIndex);
      if (!chain?.enabled || !chain.modules?.length) continue;

      chain.modules.forEach((module) => {
        if (module.category !== "source") return;

        const runtime = getModuleRuntime(chainIndex, module.id);
        if (!runtime?.getOutputValue) return;

        const value = runtime.getOutputValue();
        const displayValue = value.toFixed(3);

        if (chainIndex === getSelectedChainIndex()) {
          const card = signalFlow?.querySelector(
            `[data-module-id="${module.id}"]`
          ) as HTMLElement | null;
          if (card) {
            const display = (card as unknown as Record<string, unknown>).outputLevelDisplay as HTMLElement | undefined;
            if (display) {
              display.textContent = displayValue;
              display.className = `module-output-level ${this.getLevelClass(value)}`;
            }
          }
        }
      });
    }
  }
}
