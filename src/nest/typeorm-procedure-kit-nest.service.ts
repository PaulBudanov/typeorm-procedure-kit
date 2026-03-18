import {
  Inject,
  Injectable,
  type OnApplicationShutdown,
  type OnModuleInit,
  Scope,
} from '@nestjs/common';

import { TypeOrmProcedureKit } from '../core/index.js';
import type { DataSource } from '../typeorm/data-source/DataSource.js';
import type { TAdapterUtilsClassTypes } from '../types/adapter.types.js';
import type { IModuleConfig } from '../types/base.types.js';
import type { ILoggerModule } from '../types/logger.types.js';
import type { TSerializerTypeCastWithoutFormat } from '../types/serializer.types.js';

import { DATABASE_CONFIG_TOKEN } from './consts.js';

@Injectable({ scope: Scope.DEFAULT })
export class TypeOrmProcedureKitNestService
  extends TypeOrmProcedureKit
  implements OnModuleInit, OnApplicationShutdown
{
  private settingsLoger: ILoggerModule;
  /**
   * Creates an instance of TypeOrmProcedureKitService.
   * @param config - Configuration of TypeOrmProcedureKitNestService.
   */
  public constructor(@Inject(DATABASE_CONFIG_TOKEN) config: IModuleConfig) {
    super(config);
    this.settingsLoger = config.logger;
  }

  /**
   * This method is called once the module has finished initializing.
   * It is used to initialize the database connection.
   * @returns {Promise<void>} - a promise that resolves when the database connection is initialized
   */
  public async onModuleInit(): Promise<void> {
    await this.initDatabase();
  }

  public async onApplicationShutdown(): Promise<void> {
    try {
      if (this.dataSource && this.dataSource.isInitialized)
        await this.dataSource.destroy();
    } catch (error: unknown) {
      this.settingsLoger.error((error as Error)?.message);
    }
  }

  public override get serializerReadOnlyMapping(): Readonly<TSerializerTypeCastWithoutFormat> {
    return super.serializerReadOnlyMapping;
  }

  public override get databaseAdapter(): TAdapterUtilsClassTypes {
    return super.databaseAdapter;
  }

  public override get dataSource(): DataSource {
    return super.dataSource;
  }
}
