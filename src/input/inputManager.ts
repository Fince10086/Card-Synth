/**
 * Input manager - handles keyboard and MIDI input
 */

import { clamp, noteFromOffset } from "../utils/helpers";
import { KEY_MAP } from "../core/keyboard";
import * as Tone from "tone";
import { t } from "../i18n";
import type { GlobalState } from "../types";

export interface InputManagerOptions {
  onAttack?: (note: string, velocity: number) => void;
  onRelease?: (note: string) => void;
  onEnsureAudioStarted?: () => Promise<void>;
  onOctaveChange?: (octave: number) => void;
  onVelocityChange?: (velocity: number) => void;
  onUpdateKeyboardKeyState?: (key: string, active: boolean) => void;
  onRenderMainCardContent?: () => void;
  getGlobalState?: () => GlobalState;
  getKeyboardElement?: () => HTMLElement | null;
  getTransportInfoElement?: () => HTMLElement | null;
  onSetCustomPreset?: () => void;
}

interface MidiState {
  supported: boolean;
  access: MIDIAccess | null;
  inputs: MIDIInput[];
  selectedInputId: string;
  status: string;
  activeNotes: Map<number, string>;
}

export class InputManager {
  onAttack: (note: string, velocity: number) => void;
  onRelease: (note: string) => void;
  onEnsureAudioStarted: () => Promise<void>;
  onOctaveChange: (octave: number) => void;
  onVelocityChange: (velocity: number) => void;
  onUpdateKeyboardKeyState: (key: string, active: boolean) => void;
  onRenderMainCardContent: () => void;
  getGlobalState: () => GlobalState;
  getKeyboardElement: () => HTMLElement | null;
  getTransportInfoElement: () => HTMLElement | null;
  onSetCustomPreset: () => void;

  heldComputerKeys: Map<string, string | null>;
  activeNoteRefs: Map<string, number>;
  midi: MidiState;

  boundOnKeyDown: (event: KeyboardEvent) => void;
  boundOnKeyUp: (event: KeyboardEvent) => void;
  boundOnBlur: () => void;
  boundOnVisibilityChange: () => void;

  constructor(options: InputManagerOptions = {}) {
    this.onAttack = options.onAttack || (() => {});
    this.onRelease = options.onRelease || (() => {});
    this.onEnsureAudioStarted = options.onEnsureAudioStarted || (async () => {});
    this.onOctaveChange = options.onOctaveChange || (() => {});
    this.onVelocityChange = options.onVelocityChange || (() => {});
    this.onUpdateKeyboardKeyState = options.onUpdateKeyboardKeyState || (() => {});
    this.onRenderMainCardContent = options.onRenderMainCardContent || (() => {});
    this.getGlobalState = options.getGlobalState || (() => ({ octave: 4, velocity: 0.8 } as GlobalState));
    this.getKeyboardElement = options.getKeyboardElement || (() => null);
    this.getTransportInfoElement = options.getTransportInfoElement || (() => null);
    this.onSetCustomPreset = options.onSetCustomPreset || (() => {});

    this.heldComputerKeys = new Map();
    this.activeNoteRefs = new Map();

    this.midi = {
      supported: typeof navigator !== "undefined" && "requestMIDIAccess" in navigator,
      access: null,
      inputs: [],
      selectedInputId: "",
      status: t("MIDI idle"),
      activeNotes: new Map(),
    };

    this.boundOnKeyDown = this.onKeyDown.bind(this);
    this.boundOnKeyUp = this.onKeyUp.bind(this);
    this.boundOnBlur = () => this.releaseAllNotes();
    this.boundOnVisibilityChange = () => {
      if (document.hidden) this.releaseAllNotes();
    };
  }

  bindEvents(): void {
    window.addEventListener("keydown", this.boundOnKeyDown);
    window.addEventListener("keyup", this.boundOnKeyUp);
    window.addEventListener("blur", this.boundOnBlur);
    document.addEventListener("visibilitychange", this.boundOnVisibilityChange);
  }

  unbindEvents(): void {
    window.removeEventListener("keydown", this.boundOnKeyDown);
    window.removeEventListener("keyup", this.boundOnKeyUp);
    window.removeEventListener("blur", this.boundOnBlur);
    document.removeEventListener("visibilitychange", this.boundOnVisibilityChange);
  }

  getMidiStatus(): string {
    return this.midi.status;
  }

  getMidiSupported(): boolean {
    return this.midi.supported;
  }

  getMidiInputs(): MIDIInput[] {
    return this.midi.inputs;
  }

  getMidiSelectedInputId(): string {
    return this.midi.selectedInputId;
  }

  async requestMidiAccess(): Promise<void> {
    if (!this.midi.supported) {
      this.midi.status = t("Web MIDI unsupported");
      this.onRenderMainCardContent();
      return;
    }

    try {
      if (!this.midi.access) {
        this.midi.access = await navigator.requestMIDIAccess();
        this.midi.access.onstatechange = () => this.handleMidiStateChange();
      }
    } catch (_error) {
      this.midi.status = t("MIDI access denied");
      this.onRenderMainCardContent();
      return;
    }

    this.midi.inputs = Array.from(this.midi.access.inputs.values());
    if (!this.midi.inputs.length) {
      this.midi.selectedInputId = "";
      this.midi.status = t("No MIDI inputs");
      return;
    }

    if (!this.midi.inputs.some((input) => input.id === this.midi.selectedInputId)) {
      this.midi.selectedInputId = this.midi.inputs[0].id;
    }

    this.selectMidiInput(this.midi.selectedInputId, false);
  }

  handleMidiStateChange(): void {
    if (!this.midi.access) return;
    this.midi.inputs = Array.from(this.midi.access.inputs.values());
    if (!this.midi.inputs.length) {
      this.midi.selectedInputId = "";
      this.midi.status = t("No MIDI inputs");
      this.onRenderMainCardContent();
      return;
    }

    if (!this.midi.inputs.some((input) => input.id === this.midi.selectedInputId)) {
      this.midi.selectedInputId = this.midi.inputs[0].id;
    }

    this.selectMidiInput(this.midi.selectedInputId);
  }

  selectMidiInput(inputId: string, rerender = true): void {
    this.midi.selectedInputId = inputId;
    this.midi.inputs.forEach((input) => {
      input.onmidimessage = input.id === inputId ? (event) => this.handleMidiMessage(event) : null;
    });

    const selected = this.midi.inputs.find((input) => input.id === inputId);
    this.midi.status = selected ? t("MIDI {{name}}", { name: selected.name || selected.id }) : t("No MIDI input");
    if (rerender) {
      this.onRenderMainCardContent();
    }
  }

  closeMidi(): void {
    this.releaseAllNotes();
    this.midi.inputs.forEach((input) => {
      input.onmidimessage = null;
    });
    this.midi.selectedInputId = "";
    this.midi.status = t("MIDI off");
    if (this.midi.access) {
      this.midi.access.onstatechange = null;
      this.midi.access = null;
    }
    this.midi.inputs = [];
    this.onRenderMainCardContent();
  }

  async handleMidiMessage(event: MIDIMessageEvent): Promise<void> {
    const [status, data1, data2] = event.data;
    const command = status & 0xf0;
    const note = Tone.Frequency(data1, "midi").toNote();

    if (command === 0x90 && data2 > 0) {
      await this.onEnsureAudioStarted();
      const velocity = clamp(data2 / 127, 0.05, 1);
      this.midi.activeNotes.set(data1, note);
      this.pressNote(note, velocity);
      return;
    }

    if (command === 0x80 || (command === 0x90 && data2 === 0)) {
      this.midi.activeNotes.delete(data1);
      this.releaseNote(note);
    }
  }

  updateTransportInfo(): void {
    const transportInfo = this.getTransportInfoElement();
    const global = this.getGlobalState();
    if (transportInfo) {
      transportInfo.textContent = t("Oct {{octave}} / Vel {{velocity}}%", {
        octave: global.octave,
        velocity: Math.round(global.velocity * 100),
      });
    }
  }

  async onKeyDown(event: KeyboardEvent): Promise<void> {
    if (event.repeat) {
      return;
    }

    // 在输入框中打字时不触发琴声
    const target = event.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    ) {
      return;
    }

    const key = event.key.toLowerCase();
    const global = this.getGlobalState();

    // Octave control
    if (key === "z" || key === "x") {
      const delta = key === "z" ? -1 : 1;
      const newOctave = clamp(global.octave + delta, 1, 7);
      this.onOctaveChange(newOctave);
      this.onSetCustomPreset();
      this.updateTransportInfo();
      if (!this.heldComputerKeys.has(key)) {
        this.heldComputerKeys.set(key, null);
        this.onUpdateKeyboardKeyState(key, true);
      }
      return;
    }

    // Velocity control
    if (key === "c" || key === "v") {
      const delta = key === "c" ? -0.05 : 0.05;
      const newVelocity = clamp(Number((global.velocity + delta).toFixed(2)), 0.1, 1);
      this.onVelocityChange(newVelocity);
      this.onSetCustomPreset();
      this.updateTransportInfo();
      return;
    }

    // Note trigger
    const entry = KEY_MAP.get(key);
    if (!entry) {
      return;
    }

    await this.onEnsureAudioStarted();
    const note = noteFromOffset(global.octave, entry.offset);
    if (!this.heldComputerKeys.has(key)) {
      this.heldComputerKeys.set(key, note);
      this.pressNote(note);
      this.onUpdateKeyboardKeyState(key, true);
    }
  }

  onKeyUp(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if (!this.heldComputerKeys.has(key)) {
      return;
    }

    const note = this.heldComputerKeys.get(key);
    this.heldComputerKeys.delete(key);
    this.onUpdateKeyboardKeyState(key, false);

    if (note) {
      this.releaseNote(note);
    }
  }

  pressNote(note: string, velocity?: number): void {
    const global = this.getGlobalState();
    const actualVelocity = velocity !== undefined ? velocity : global.velocity;
    const count = this.activeNoteRefs.get(note) || 0;
    this.activeNoteRefs.set(note, count + 1);
    if (!count) {
      this.onAttack(note, actualVelocity);
    }
  }

  releaseNote(note: string): void {
    const count = this.activeNoteRefs.get(note) || 0;
    if (count <= 1) {
      this.activeNoteRefs.delete(note);
      this.onRelease(note);
      return;
    }
    this.activeNoteRefs.set(note, count - 1);
  }

  releaseAllNotes(): void {
    this.activeNoteRefs.forEach((_, note) => {
      this.onRelease(note);
    });
    this.activeNoteRefs.clear();
    this.heldComputerKeys.clear();
    this.midi.activeNotes.clear();
  }
}
