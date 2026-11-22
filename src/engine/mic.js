/**
 * Microphone input + continuous pitch tracking (~100 Hz).
 * `live` is deliberately non-reactive (updated 100×/s); UI reads it per frame.
 * The recorder subscribes with setPitchSink().
 */
import { ensureAudio, getCtx } from '../audio/context.js';
import { detectPitch, freqToMidi } from '../core/pitch.js';
import { INPUT_MODES, inputMode } from '../core/voice.js';
import { ui, status } from '../stores/ui.js';
import { project } from '../stores/project.js';

export const live = { midi: 0, clarity: 0, rms: 0 };

let stream = null, analyser = null, buf = null, timer = null;
let sink = null;

/** sink(result, perfTimeOfWindowCentreMs) */
export const setPitchSink = (fn) => { sink = fn; };
export const isMicOn = () => !!analyser;

export async function enableMic() {
  const actx = ensureAudio();
  disableMic();
  const deviceId = ui.mic.deviceId;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    });
  } catch (e) {
    status('Microphone unavailable: ' + e.message, true);
    return false;
  }
  const src = actx.createMediaStreamSource(stream);
  analyser = actx.createAnalyser();
  analyser.fftSize = 2048;
  buf = new Float32Array(analyser.fftSize);
  src.connect(analyser);
  timer = setInterval(poll, 10);
  ui.mic.on = true;
  listDevices();
  status('Mic on — whistle to test the pitch readout.');
  return true;
}

export function disableMic() {
  clearInterval(timer);
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  analyser = null;
  live.midi = 0;
  ui.mic.on = false;
}

export async function listDevices() {
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    ui.mic.devices = devs.map((d) => ({ id: d.deviceId, label: d.label || 'Input ' + d.deviceId.slice(0, 5) }));
  } catch { /* ignore */ }
}

function poll() {
  if (!analyser) return;
  analyser.getFloatTimeDomainData(buf);
  const sr = getCtx().sampleRate;
  const r = detectPitch(buf, sr, INPUT_MODES[inputMode(project.settings)]); // whistle or hum range
  live.rms = r.rms;
  live.clarity = r.clarity;
  live.midi = r.freq ? freqToMidi(r.freq) : 0;
  // timestamp the centre of the analysis window
  if (sink) sink({ midi: live.midi, clarity: r.clarity }, performance.now() - (buf.length / 2 / sr) * 1000);
}

// Holds app state: hot-swapping this module would leave stale copies in memory
// (UI and actions talking to different objects). Ask Vite for a full reload instead.
import.meta.hot?.decline();
