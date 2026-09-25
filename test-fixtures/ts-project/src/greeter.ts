export class Greeter {
  constructor(private readonly name: string) {}

  greet(): string {
    return `Hello, ${this.decorate(this.name)}!`;
  }

  private decorate(value: string): string {
    return value.toUpperCase();
  }
}
