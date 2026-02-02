import { Inject, Injectable, type OnModuleInit, Scope } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { TypeOrmProcedureKit } from '../core/index.js';
import type { TAdapterUtilsClassTypes } from '../types/adapter.types.js';
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

  /**
   * This method is called once the module has finished initializing.
   * It is used to initialize the database connection.
   * @returns {Promise<void>} - a promise that resolves when the database connection is initialized
   */
  public async onModuleInit(): Promise<void> {
    await this.initDatabase();
  }

  public get serializerReadOnlyMapping(): Readonly<TSerializerTypeCastWithoutFormat> {
    return super.serializerReadOnlyMapping;
  }

  public get databaseAdapter(): TAdapterUtilsClassTypes {
    return super.databaseAdapter;
  }

  public get dataSource(): DataSource {
    return super.dataSource;
  }
}
