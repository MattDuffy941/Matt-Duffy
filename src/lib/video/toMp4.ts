/**
 * Transcode a recorded WebM blob to H.264/AAC MP4 using ffmpeg.wasm.
 *
 * ffmpeg.wasm and its ~25 MB core are loaded lazily (only when the user picks
 * MP4) from a CDN, so WebM users never download them. The single-threaded core
 * is used so it works on static hosts (GitHub Pages) without the COOP/COEP
 * headers the multi-threaded core needs.
 */

const CORE_VERSION = '0.12.6';
const CORE_BASE = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

let ffmpegPromise: Promise<import('@ffmpeg/ffmpeg').FFmpeg> | null = null;

async function getFFmpeg(onProgress?: (fraction: number) => void) {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const { toBlobURL } = await import('@ffmpeg/util');
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      return ffmpeg;
    })();
  }
  const ffmpeg = await ffmpegPromise;
  if (onProgress) {
    ffmpeg.on('progress', ({ progress }) => onProgress(Math.max(0, Math.min(1, progress))));
  }
  return ffmpeg;
}

export async function transcodeToMp4(
  webm: Blob,
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  const { fetchFile } = await import('@ffmpeg/util');
  const ffmpeg = await getFFmpeg(onProgress);
  await ffmpeg.writeFile('in.webm', await fetchFile(webm));
  await ffmpeg.exec([
    '-i', 'in.webm',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'veryfast',
    '-c:a', 'aac',
    '-b:a', '160k',
    'out.mp4',
  ]);
  const data = await ffmpeg.readFile('out.mp4');
  // data is a Uint8Array; wrap in a fresh ArrayBuffer-backed copy for Blob
  const bytes = data as Uint8Array;
  return new Blob([bytes.slice()], { type: 'video/mp4' });
}
