export function add(a: number, b: number): number {
  return a + b;
}

export function sum(values: number[]): number {
  return values.reduce((total, v) => add(total, v), 0);
}

export function untested(): string {
  return 'nobody calls me';
}
