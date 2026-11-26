/**
 * Minimal PCM WAV decoder for the GoldSrc sound files (8-bit unsigned or
 * 16-bit signed, mono or stereo). Decoding ourselves avoids depending on
 * which WAV variants the system WebView's decodeAudioData accepts.
 */
export interface DecodedWav {
  sampleRate: number;
  /** One Float32Array per channel, samples in [-1, 1]. */
  channels: Float32Array<ArrayBuffer>[];
}

function tag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

export function decodeWav(buffer: ArrayBuffer): DecodedWav | null {
  const view = new DataView(buffer);
  if (buffer.byteLength < 12 || tag(view, 0) !== "RIFF" || tag(view, 8) !== "WAVE") return null;

  let format = 0;
  let channelCount = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataSize = 0;

  // Walk the chunks: GoldSrc files often carry extra ones (cue, LIST) around "data".
  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const id = tag(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      format = view.getUint16(body, true);
      channelCount = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === "data") {
      dataOffset = body;
      dataSize = Math.min(size, buffer.byteLength - body);
    }
    offset = body + size + (size % 2); // chunks are word-aligned
  }

  const pcm = format === 1;
  if (!pcm || dataOffset < 0 || channelCount < 1 || !sampleRate) return null;
  if (bitsPerSample !== 8 && bitsPerSample !== 16) return null;

  const bytesPerSample = bitsPerSample / 8;
  const frameCount = Math.floor(dataSize / (bytesPerSample * channelCount));
  const channels = Array.from({ length: channelCount }, () => new Float32Array(frameCount));

  for (let frame = 0; frame < frameCount; frame++) {
    for (let ch = 0; ch < channelCount; ch++) {
      const pos = dataOffset + (frame * channelCount + ch) * bytesPerSample;
      channels[ch][frame] =
        bitsPerSample === 8
          ? (view.getUint8(pos) - 128) / 128
          : view.getInt16(pos, true) / 32768;
    }
  }

  return { sampleRate, channels };
}
