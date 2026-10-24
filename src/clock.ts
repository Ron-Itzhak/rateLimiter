export interface Clock {
  monotonicMs(): number;
  unixMs(): number;
}

export class SystemClock implements Clock {
  monotonicMs(): number { return performance.now(); }
  unixMs(): number { return Date.now(); }
}
