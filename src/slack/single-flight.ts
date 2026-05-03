export class SingleFlight<T> {
  private inFlight: Promise<T> | null = null;

  run(factory: () => Promise<T>): Promise<T> {
    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = factory().finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }
}
