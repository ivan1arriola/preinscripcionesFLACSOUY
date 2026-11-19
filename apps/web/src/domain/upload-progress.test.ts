import { describe, expect, it } from 'vitest';
import { UploadProgressEstimator, isStalled } from './upload-progress.js';

describe('UploadProgressEstimator', () => {
  it('waits for two real samples before estimating remaining time', () => {
    const estimator = new UploadProgressEstimator(1000);
    expect(estimator.sample(100, 1000)).toEqual({ percent: 10, remainingSeconds: undefined });
    expect(estimator.sample(300, 2000)).toEqual({ percent: 30, remainingSeconds: 3.5 });
  });

  it('keeps the previous smoothed speed when a sample makes no progress', () => {
    const estimator = new UploadProgressEstimator(1000);
    estimator.sample(100, 1000);
    estimator.sample(300, 2000);
    expect(estimator.sample(300, 3000).remainingSeconds).toBe(3.5);
  });
});

describe('isStalled', () => {
  it('is stalled only after more than 5 s without progress', () => {
    expect(isStalled(undefined, 10_000)).toBe(false);
    expect(isStalled(1000, 6000)).toBe(false);
    expect(isStalled(1000, 6001)).toBe(true);
  });
});
