import type { Clock } from "../../src/clock";

export class FakeClock implements Clock {
  private elapsed = 0;
  private wall = 1_800_000_000_000;
  monotonicMs(): number {
    return this.elapsed;
  }
  unixMs(): number {
    return this.wall;
  }
  advance(ms: number): void {
    this.elapsed += ms;
    this.wall += ms;
  }
  shiftWall(ms: number): void {
    this.wall += ms;
  }
}
