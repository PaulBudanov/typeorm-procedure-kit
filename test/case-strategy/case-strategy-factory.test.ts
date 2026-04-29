import { describe, expect, it } from 'vitest';

import { CaseStrategyFactory } from '../../src/case-strategy/case-strategy-factory.js';
import { NativeStrategy } from '../../src/case-strategy/native-strategy.js';
import { OrmStrategy } from '../../src/case-strategy/orm-strategy.js';

describe('CaseStrategyFactory', (): void => {
  it('creates paired ORM and native strategies sharing the same transform behavior', (): void => {
    const { strategy, nativeStrategy } =
      CaseStrategyFactory.caseStrategyFactory('snakeCase');

    expect(strategy).toBeInstanceOf(OrmStrategy);
    expect(nativeStrategy).toBeInstanceOf(NativeStrategy);
    expect(nativeStrategy.transformColumnName('userId')).toBe('user_id');
    expect(strategy.columnName('userId', '', [])).toBe('user_id');
  });

  it('defaults to camelCase strategy', (): void => {
    const { strategy, nativeStrategy } =
      CaseStrategyFactory.caseStrategyFactory();

    expect(nativeStrategy.transformColumnName('USER_ID')).toBe('userId');
    expect(strategy.columnName('USER_ID', '', [])).toBe('userId');
  });
});
