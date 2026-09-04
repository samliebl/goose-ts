class StringReplacement {
  constructor(
    private readonly pattern: string,
    private readonly replaceWith: string,
  ) {}

  replaceAll(value: string): string {
    if (!value) return "";
    return value.split(this.pattern).join(this.replaceWith);
  }
}

/** Chainable sequence of literal string replacements. Port of goose.utils.ReplaceSequence. */
export class ReplaceSequence {
  private readonly replacements: StringReplacement[] = [];

  create(firstPattern: string, replaceWith = ""): this {
    this.replacements.push(new StringReplacement(firstPattern, replaceWith));
    return this;
  }

  append(pattern: string, replaceWith = ""): this {
    return this.create(pattern, replaceWith);
  }

  replaceAll(value: string): string {
    if (!value) return "";
    let mutated = value;
    for (const rp of this.replacements) {
      mutated = rp.replaceAll(mutated);
    }
    return mutated;
  }
}
