type HapticKind = 'eat' | 'death' | 'turn';

export function nativeHaptic(kind: HapticKind): void {
  const host = window as Window & {
    webkit?: { messageHandlers?: { haptics?: { postMessage: (value: string) => void } } };
  };
  host.webkit?.messageHandlers?.haptics?.postMessage(kind);
}
