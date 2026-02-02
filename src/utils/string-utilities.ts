export abstract class StringUtilities {
  public static isLowerOrUpperCase(str: string): boolean {
    return str === str.toLowerCase() || str === str.toUpperCase();
  }

  /**
   * Convert a string to camel case.
   * @example
   * StringUtilities.toCamelCase('hello world') // 'helloWorld'
   * StringUtilities.toCamelCase('hello-world') // 'helloWorld'
   * StringUtilities.toCamelCase('hello_world') // 'helloWorld'
   * StringUtilities.toCamelCase('hello world  ') // 'helloWorld'
   * StringUtilities.toCamelCase('helloWorld') // 'helloWorld'
   * StringUtilities.toCamelCase('HelloWorld') // 'helloWorld'
   * StringUtilities.toCamelCase('Hello world') // 'helloWorld'
   * StringUtilities.toCamelCase('Hello-world') // 'helloWorld'
   * StringUtilities.toCamelCase('Hello_world') // 'helloWorld'
   * StringUtilities.toCamelCase('Hello world  ') // 'helloWorld'
   * @param {string} input - string to convert
   * @returns {string} - converted string
   */
  public static toCamelCase(input: string): string {
    if (!input || typeof input !== 'string') return '';

    const length = input.length;
    if (length === 0) return '';
    if (length === 1) return input.toLowerCase();

    const result: Array<string> = [];
    let capitalizeNext = false;
    let firstCharFound = false;

    for (let i = 0; i < length; i++) {
      const char = input[i] as string;

      if (char === '_' || char === '-' || char === ' ' || char === '.') {
        if (firstCharFound) {
          capitalizeNext = true;
        }
        continue;
      }

      if (!firstCharFound) {
        result.push(char.toLowerCase());
        firstCharFound = true;
        capitalizeNext = false;
        continue;
      }

      if (capitalizeNext) {
        result.push(char.toUpperCase());
        capitalizeNext = false;
      } else {
        result.push(char.toLowerCase());
      }
    }

    return result.join('');
  }
  public static toSnakeCase(input: string): string {
    if (!input || typeof input !== 'string') return '';

    const length = input.length;
    if (length === 0) return '';
    if (length === 1) return input.toLowerCase();

    // Предварительная оценка размера результата
    const estimatedSize = Math.max(1, Math.floor(length * 1.2));
    const result = new Array<string>(estimatedSize);
    let resultIndex = 0;
    let lastWasSeparator = false;
    let lastWasUpper = false;
    let hasPrevChar = false;

    for (let i = 0; i < length; i++) {
      const char = input[i] as string;

      if (
        !hasPrevChar &&
        (char === '_' || char === '-' || char === ' ' || char === '.')
      ) {
        continue;
      }

      if (char === '_' || char === '-' || char === ' ' || char === '.') {
        if (!lastWasSeparator) {
          result[resultIndex++] = '_';
          lastWasSeparator = true;
        }
        lastWasUpper = false;
        hasPrevChar = true;
        continue;
      }

      if (char >= 'A' && char <= 'Z') {
        const isLastChar = i === length - 1;
        const nextChar = isLastChar ? '' : (input[i + 1] as string);

        if (hasPrevChar && !lastWasSeparator && !lastWasUpper) {
          result[resultIndex++] = '_';
        }

        if (hasPrevChar && lastWasUpper && nextChar >= 'a' && nextChar <= 'z') {
          result[resultIndex++] = '_';
        }

        result[resultIndex++] = char.toLowerCase();
        lastWasSeparator = false;
        lastWasUpper = true;
        hasPrevChar = true;
      } else {
        result[resultIndex++] = char.toLowerCase();
        lastWasSeparator = false;
        lastWasUpper = false;
        hasPrevChar = true;
      }

      if (resultIndex >= result.length) {
        result.push('');
      }
    }

    if (resultIndex > 0 && result[resultIndex - 1] === '_') {
      resultIndex--;
    }

    return resultIndex > 0 ? result.slice(0, resultIndex).join('') : '';
  }

  public static capitalize(str: string): string {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  public static toLowerCase(str: string): string {
    if (!str || typeof str !== 'string') return '';
    return str.toLowerCase();
  }
}
