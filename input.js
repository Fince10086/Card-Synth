/**
 * input.js
 * 输入管理器 - InputManager
 *
 * 负责：
 * - MIDI 输入设备管理和消息处理
 * - 电脑键盘输入处理
 * - 音符触发和释放的引用计数
 */

class InputManager {
  constructor(options = {}) {
    this.onAttack = options.onAttack || (() => {});
    this.onRelease = options.onRelease || (() => {});
    this.onEnsureAudioStarted = options.onEnsureAudioStarted || (() => {});
    this.onOctaveChange = options.onOctaveChange || (() => {});
    this.onVelocityChange = options.onVelocityChange || (() => {});
    this.onUpdateKeyboardKeyState = options.onUpdateKeyboardKeyState || (() => {});
    this.onRenderMainCardContent = options.onRenderMainCardContent || (() => {});
    this.getGlobalState = options.getGlobalState || (() => ({ octave: 4, velocity: 0.8 }));
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
      status: "MIDI idle",
      activeNotes: new Map(),
    };

    this.boundOnKeyDown = this.onKeyDown.bind(this);
    this.boundOnKeyUp = this.onKeyUp.bind(this);
  }

  bindEvents() {
    window.addEventListener("keydown", this.boundOnKeyDown);
    window.addEventListener("keyup", this.boundOnKeyUp);
  }

  unbindEvents() {
    window.removeEventListener("keydown", this.boundOnKeyDown);
    window.removeEventListener("keyup", this.boundOnKeyUp);
  }

  getMidiStatus() {
    return this.midi.status;
  }

  getMidiSupported() {
    return this.midi.supported;
  }

  getMidiInputs() {
    return this.midi.inputs;
  }

  getMidiSelectedInputId() {
    return this.midi.selectedInputId;
  }

  async requestMidiAccess() {
    if (!this.midi.supported) {
      this.midi.status = "Web MIDI unsupported";
      this.onRenderMainCardContent();
      return;
    }

    try {
      if (!this.midi.access) {
        this.midi.access = await navigator.requestMIDIAccess();
        this.midi.access.onstatechange = () => this.handleMidiStateChange();
      }
    } catch (error) {
      this.midi.status = "MIDI access denied";
      this.onRenderMainCardContent();
      return;
    }

    this.midi.inputs = Array.from(this.midi.access.inputs.values());
    if (!this.midi.inputs.length) {
      this.midi.selectedInputId = "";
      this.midi.status = "No MIDI inputs";
      return;
    }

    if (!this.midi.inputs.some((input) => input.id === this.midi.selectedInputId)) {
      this.midi.selectedInputId = this.midi.inputs[0].id;
    }

    this.selectMidiInput(this.midi.selectedInputId, false);
  }

  handleMidiStateChange() {
    this.midi.inputs = Array.from(this.midi.access.inputs.values());
    if (!this.midi.inputs.length) {
      this.midi.selectedInputId = "";
      this.midi.status = "No MIDI inputs";
      this.onRenderMainCardContent();
      return;
    }

    if (!this.midi.inputs.some((input) => input.id === this.midi.selectedInputId)) {
      this.midi.selectedInputId = this.midi.inputs[0].id;
    }

    this.selectMidiInput(this.midi.selectedInputId);
  }

  selectMidiInput(inputId, rerender = true) {
    this.midi.selectedInputId = inputId;
    this.midi.inputs.forEach((input) => {
      input.onmidimessage = input.id === inputId ? (event) => this.handleMidiMessage(event) : null;
    });

    const selected = this.midi.inputs.find((input) => input.id === inputId);
    this.midi.status = selected ? `MIDI ${selected.name || selected.id}` : "No MIDI input";
    if (rerender) {
      this.onRenderMainCardContent();
    }
  }

  closeMidi() {
    this.releaseAllNotes();
    this.midi.inputs.forEach((input) => {
      input.onmidimessage = null;
    });
    this.midi.selectedInputId = "";
    this.midi.status = "MIDI off";
    if (this.midi.access) {
      this.midi.access.onstatechange = null;
      this.midi.access = null;
    }
    this.midi.inputs = [];
    this.onRenderMainCardContent();
  }

  async handleMidiMessage(event) {
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

  updateTransportInfo() {
    const transportInfo = this.getTransportInfoElement();
    const global = this.getGlobalState();
    if (transportInfo) {
      transportInfo.textContent = `Oct ${global.octave} / Vel ${Math.round(global.velocity * 100)}%`;
    }
  }

  async onKeyDown(event) {
    const targetTag = event.target?.tagName;
    if (targetTag === "INPUT" || targetTag === "SELECT" || event.repeat) {
      return;
    }

    const key = event.key.toLowerCase();
    const global = this.getGlobalState();

    if (key === "z") {
      const newOctave = clamp(global.octave - 1, 1, 7);
      this.onOctaveChange(newOctave);
      this.onSetCustomPreset();
      this.updateTransportInfo();
      return;
    }
    if (key === "x") {
      const newOctave = clamp(global.octave + 1, 1, 7);
      this.onOctaveChange(newOctave);
      this.onSetCustomPreset();
      this.updateTransportInfo();
      return;
    }
    if (key === "c") {
      const newVelocity = clamp(Number((global.velocity - 0.05).toFixed(2)), 0.1, 1);
      this.onVelocityChange(newVelocity);
      this.onSetCustomPreset();
      this.updateTransportInfo();
      return;
    }
    if (key === "v") {
      const newVelocity = clamp(Number((global.velocity + 0.05).toFixed(2)), 0.1, 1);
      this.onVelocityChange(newVelocity);
      this.onSetCustomPreset();
      this.updateTransportInfo();
      return;
    }

    const entry = KEYBOARD_LAYOUT.find((item) => item.key === key);
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

  onKeyUp(event) {
    const key = event.key.toLowerCase();
    const note = this.heldComputerKeys.get(key);
    if (!note) {
      return;
    }

    this.heldComputerKeys.delete(key);
    this.releaseNote(note);
    this.onUpdateKeyboardKeyState(key, false);
  }

  pressNote(note, velocity) {
    const global = this.getGlobalState();
    const actualVelocity = velocity !== undefined ? velocity : global.velocity;
    const count = this.activeNoteRefs.get(note) || 0;
    this.activeNoteRefs.set(note, count + 1);
    if (!count) {
      this.onAttack(note, actualVelocity);
    }
  }

  releaseNote(note) {
    const count = this.activeNoteRefs.get(note) || 0;
    if (count <= 1) {
      this.activeNoteRefs.delete(note);
      this.onRelease(note);
      return;
    }
    this.activeNoteRefs.set(note, count - 1);
  }

  releaseAllNotes() {
    this.activeNoteRefs.forEach((_, note) => {
      this.onRelease(note);
    });
    this.activeNoteRefs.clear();
    this.heldComputerKeys.clear();
    this.midi.activeNotes.clear();
  }
}
