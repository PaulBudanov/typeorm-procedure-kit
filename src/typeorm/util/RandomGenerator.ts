import { createHash } from 'node:crypto';

export class RandomGenerator {
  public static hash(value: string, algorithm: string): string {
    return createHash(algorithm).update(value, 'utf8').digest('hex');
  }
}
