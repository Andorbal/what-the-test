export interface Shape {
  area(): number;
}

export abstract class Polygon implements Shape {
  abstract area(): number;

  describe(): string {
    return `a polygon with area ${this.area()}`;
  }
}

export class Square extends Polygon {
  constructor(private readonly side: number) {
    super();
  }

  area(): number {
    return this.side * this.side;
  }
}

export function totalArea(shapes: Shape[]): number {
  return shapes.reduce((total, shape) => total + shape.area(), 0);
}

export function isLarge(square: Square): boolean {
  return square.area() > 100;
}
