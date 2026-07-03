/**
 * Record a play-along video: the engraved notation with a vertical marker that
 * sweeps across in time with the metronome, plus the drum + click audio.
 *
 * The marker is driven by the player's loop progress, which comes from the same
 * AudioContext clock the drums are scheduled on — so the marker and the audio
 * share one clock and stay locked. Capture is real time (recording a 2-bar loop
 * takes as long as playing it once).
 *
 * Output is WebM (MediaRecorder). MP4 is produced by transcoding the WebM with
 * ffmpeg.wasm — see toMp4.ts (lazy-loaded only when MP4 is requested).
 */

import { GrooveData } from '../grooveData';
import { GroovePlayer } from '../audio/player';

function svgToImage(container: HTMLElement): Promise<{ img: HTMLImageElement; w: number; h: number }> {
  const svg = container.querySelector('svg');
  if (!svg) return Promise.reject(new Error('no notation to record'));
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const vb = svg.viewBox.baseVal;
  const w = vb && vb.width ? vb.width : svg.clientWidth;
  const h = vb && vb.height ? vb.height : svg.clientHeight;
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  const img = new Image();
  return new Promise((resolve, reject) => {
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ img, w, h });
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

function pickMime(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  }
  return 'video/webm';
}

export function videoRecordingSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  );
}

export interface RecordOptions {
  player: GroovePlayer;
  groove: GrooveData;
  notationEl: HTMLElement;
  loops: number;
  /** 0..1 progress of the recording. */
  onProgress?: (fraction: number) => void;
}

/** Record `loops` passes of the groove and resolve to a WebM Blob. */
export async function recordWebM(opts: RecordOptions): Promise<Blob> {
  const { player, groove, notationEl, loops, onProgress } = opts;
  if (!videoRecordingSupported()) {
    throw new Error('Video recording is not supported in this browser.');
  }

  const { img, w: rawW, h: rawH } = await svgToImage(notationEl);
  // H.264 (for the MP4 step) needs even dimensions; cap width for sane bitrate.
  const scale = Math.min(1, 1280 / rawW);
  const w = Math.round((rawW * scale) / 2) * 2;
  const h = Math.round((rawH * scale) / 2) * 2;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const inset = w * 0.1; // rough clef/time-sig gutter the marker starts after
  const draw = (progress: number) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const x = inset + progress * (w - inset * 1.2);
    ctx.fillStyle = 'rgba(79, 142, 247, 0.35)';
    ctx.fillRect(x - 3, 0, 6, h);
    ctx.fillStyle = 'rgba(79, 142, 247, 0.9)';
    ctx.fillRect(x - 1, 0, 2, h);
  };
  draw(0);

  const audioStream = player.getAudioStream();
  const videoStream = canvas.captureStream(30);
  const combined = new MediaStream([
    ...videoStream.getVideoTracks(),
    ...audioStream.getAudioTracks(),
  ]);

  const mime = pickMime();
  const recorder = new MediaRecorder(combined, { mimeType: mime, videoBitsPerSecond: 5_000_000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  return new Promise<Blob>((resolve, reject) => {
    let raf = 0;
    let stopped = false;

    const cleanup = () => {
      cancelAnimationFrame(raf);
      videoStream.getVideoTracks().forEach((t) => t.stop());
    };

    recorder.onstop = () => {
      cleanup();
      resolve(new Blob(chunks, { type: mime }));
    };
    recorder.onerror = () => {
      cleanup();
      player.stop();
      reject(new Error('Recording failed.'));
    };

    // Start audio playback (no count-in, constant tempo) and the recorder.
    player.start(groove, { countIn: false, rampBpmPerLoop: 0 });
    recorder.start();

    const totalSeconds = player.loopDurationSeconds() * loops;
    const startedAt = performance.now();

    const tick = () => {
      if (stopped) return;
      draw(player.loopProgress());
      const elapsed = (performance.now() - startedAt) / 1000;
      onProgress?.(Math.min(1, elapsed / totalSeconds));
      if (elapsed >= totalSeconds) {
        stopped = true;
        player.stop();
        // brief tail so the final hit's decay is captured
        setTimeout(() => recorder.state !== 'inactive' && recorder.stop(), 250);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
