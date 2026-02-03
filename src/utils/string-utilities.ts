import { camelCase, snakeCase } from 'lodash-es';
export abstract class StringUtilities {
  public static toCamelCase(input: string | undefined): string {
    return camelCase(input);
  }
  public static toSnakeCase(input: string | undefined): string {
    return snakeCase(input);
  }

  public static toLowerCase(input: string | undefined): string {
    if (!input) return '';
    return input.toLowerCase();
  }
}
