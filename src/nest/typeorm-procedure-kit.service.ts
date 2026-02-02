import { Inject, Injectable, type OnModuleInit, Scope } from '@nestjs/common';

import { TypeOrmProcedureKit } from '../core/index.js';
import type { IModuleConfig } from '../types/base.types.js';
import type { TSerializerTypeCastWithoutFormat } from '../types/serializer.types.js';

import { DATABASE_CONFIG_TOKEN } from './consts.js';

@Injectable({ scope: Scope.DEFAULT })
export class TypeOrmProcedureKitService
  extends TypeOrmProcedureKit
  implements OnModuleInit
{
  /**
   * Creates an instance of TypeOrmProcedureKitService.
   * @param config - Configuration of TypeORMProcedureKit.
   */
  public constructor(@Inject(DATABASE_CONFIG_TOKEN) config: IModuleConfig) {
    super(config);
  }

  public async onModuleInit(): Promise<void> {
    await this.initDatabase();
  }

  public get serializerReadOnlyMapping(): Readonly<TSerializerTypeCastWithoutFormat> {
    return super.serializerReadOnlyMapping;
  }
}
