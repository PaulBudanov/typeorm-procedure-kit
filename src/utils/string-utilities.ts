import camelCase from 'lodash/camelCase.js';
import snakeCase from 'lodash/snakeCase.js';

class StringUtilitiesApi {
  public toCamelCase(input: string | undefined): string {
    return camelCase(input);
  }
  public toSnakeCase(input: string | undefined): string {
    return snakeCase(input);
  }

  public toLowerCase(input: string | undefined): string {
    if (!input) return '';
    return input.toLowerCase();
  }
}

const stringUtilities = new StringUtilitiesApi();

export { stringUtilities as StringUtilities };
