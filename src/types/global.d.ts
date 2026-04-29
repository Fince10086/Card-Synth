/**
 * Global type declarations
 */

interface Window {
  // Add any global window properties here if needed
}

// Extend MediaDevices for older browsers
declare interface Navigator {
  requestMIDIAccess?: (options?: { sysex?: boolean }) => Promise<WebMidi.MIDIAccess>;
}

// Web MIDI types
declare namespace WebMidi {
  interface MIDIAccess {
    inputs: MIDIInputMap;
    outputs: MIDIOutputMap;
    onstatechange: ((event: MIDIConnectionEvent) => void) | null;
  }

  interface MIDIInputMap extends Map<string, MIDIInput> {}
  interface MIDIOutputMap extends Map<string, MIDIOutput> {}

  interface MIDIInput {
    id: string;
    name: string;
    manufacturer: string;
    version: string;
    state: 'connected' | 'disconnected';
    connection: 'open' | 'closed' | 'pending';
    onmidimessage: ((event: MIDIMessageEvent) => void) | null;
    onstatechange: ((event: MIDIConnectionEvent) => void) | null;
  }

  interface MIDIOutput {
    id: string;
    name: string;
    manufacturer: string;
    version: string;
    state: 'connected' | 'disconnected';
    connection: 'open' | 'closed' | 'pending';
  }

  interface MIDIMessageEvent {
    data: Uint8Array;
    timeStamp: number;
  }

  interface MIDIConnectionEvent {
    port: MIDIInput | MIDIOutput;
  }
}
