export interface UploadProgress {
  percent: number;
  remainingSeconds?: number;
}

export class UploadProgressEstimator {
  private previous?: { bytes: number; time: number };
  private bytesPerSecond?: number;

  constructor(private readonly totalBytes: number) {}

  sample(bytes: number, time = Date.now()): UploadProgress {
    if (this.previous && time > this.previous.time && bytes > this.previous.bytes) {
      const currentSpeed = ((bytes - this.previous.bytes) * 1000) / (time - this.previous.time);
      this.bytesPerSecond = this.bytesPerSecond === undefined ? currentSpeed : this.bytesPerSecond * 0.7 + currentSpeed * 0.3;
    }
    if (!this.previous || bytes > this.previous.bytes) this.previous = { bytes, time };
    return {
      percent: this.totalBytes > 0 ? Math.round((bytes / this.totalBytes) * 100) : 100,
      remainingSeconds: this.bytesPerSecond ? Math.round(((this.totalBytes - bytes) / this.bytesPerSecond) * 10) / 10 : undefined,
    };
  }
}

/** Sin avance hace más de `thresholdMs`: la estimación anterior ya no es honesta. */
export function isStalled(lastProgressAt: number | undefined, now: number, thresholdMs = 5000): boolean {
  return lastProgressAt !== undefined && now - lastProgressAt > thresholdMs;
}
