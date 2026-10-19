import type p5 from "p5";

declare module "p5" {
  interface p5InstanceExtensions {
    screenPosition(x: number, y: number, z?: number): p5.Vector;
    screenPosition(v: p5.Vector | number[]): p5.Vector;
  }
}

export function addScreenPositionFunction(p5Instance: p5): void;