import { describe, expect, it } from 'vitest';

import { CaseStrategyFactory } from '../../src/case-strategy/case-strategy-factory.js';
import { OrmStrategy } from '../../src/case-strategy/orm-strategy.js';

describe('CaseStrategyFactory', (): void => {
  it('creates a shared ORM and raw result strategy', (): void => {
    const { strategy } = CaseStrategyFactory.caseStrategyFactory('snakeCase');

    expect(strategy).toBeInstanceOf(OrmStrategy);
    expect(strategy.transformColumnName('userId')).toBe('user_id');
    expect(strategy.columnName('userId', '', [])).toBe('user_id');
  });

  it('defaults to camelCase strategy', (): void => {
    const { strategy } = CaseStrategyFactory.caseStrategyFactory();

    expect(strategy.transformColumnName('USER_ID')).toBe('userId');
    expect(strategy.columnName('USER_ID', '', [])).toBe('userId');
  });
});
