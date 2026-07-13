// A short two-tone chime synthesized with the Web Audio API — no audio
// asset to bundle/license. The AudioContext is created lazily and reused
// (browsers cap how many can exist, and creating one per notification would
// leak). Wrapped in try/catch because browsers block audio before the user
// has interacted with the page at all — by the time a real notification
// fires that's essentially never an issue on a dashboard the user is using,
// but it shouldn't throw and break the notification flow if it ever is.
let audioCtx;

export function playNotificationSound() {
  try {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();

    const now = audioCtx.currentTime;
    [880, 660].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.12;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.2, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.2);
    });
  } catch {
    // Audio isn't critical to the notification — fail silently.
  }
}
