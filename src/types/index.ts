// Configuration
export type { TIdentifierQuoting } from '../typeorm/data-source/DataSourceOptions.js';
export type {
  IBaseConfig,
  IDatabaseFactory,
  IEntityOptions,
  IExecutionOptions,
  IMigrationOptions,
  TConnectionMode,
  TDbConfig,
  TOracleDbConfig,
  TPostgresDbConfig,
  IDatabaseCredentials,
  IResourceLimits,
} from './config.types.js';

// Procedures
export type {
  IProcedureArgumentBase,
  IProcedureStructuredField,
  IProcedureStructuredType,
  TDBMapStructure,
  TProcedureArgumentList,
  TProcedureArgumentMode,
  TProcedurePayload,
  TProcedurePayloadInput,
  TProcedureStructuredTypeKind,
} from './procedure.types.js';

// Notification
export type {
  ICreateNotify,
  INotifyPackageCallbackOracle,
  INotifyPackageCallbackPostgre,
  IOracleNotifyMsg,
  IOracleOptionsNotify,
  TNotifyCallbackGeneric,
  TNotifyPackageCallback,
  INotifyHealthCheckOptions,
  INotifyRetryOptions,
  INotifyRestoreOptions,
  IOracleNotifyRestoreSettings,
  IPostgreNotifyRestoreSettings,
} from './notification.types.js';

// Serializer
export type {
  ISerializerContext,
  ISerializerValues,
  ISerializerNativeValueMap,
  TSerializerInput,
  TSerializerNativeValue,
  TSerializerStrategy,
  TSerializerType,
  TTemporalSerializerType,
  TSetSerializer,
} from './serializer.types.js';

// Utility
export type {
  IBindingsObjectReturn,
  IProcedureBindingLogItem,
  IProcedureOutBinding,
  IProcedureResult,
  IProcedureQueryLogContext,
  ISqlBindingLogItem,
  ISqlQueryLogContext,
  ISqlBindingsObjectReturn,
  ISqlError,
  IEventBusService,
  ICollectionStrategy,
  TMapKey,
  TQueryLogContext,
  TQueueType,
} from './utility.types.js';

// Adapter
export type {
  IDatabaseAdapterContract,
  IRegisteredFetchHandlerOptions,
  TAdapterUtilsClassTypes,
  TConnectionClassTypes,
  TNotifyClassTypes,
  TSerializerClassTypes,
} from './adapter.types.js';

// Strategy
export type {
  ICaseStrategyFactory,
  IColumnNameTransformStrategy,
  TKeyTransformCase,
} from './strategy.types.js';

// Logger
export type {
  ILoggerModule,
  TBindingLogMode,
  TTypeOrmLoggerLevel,
  TTypeOrmLoggerLevels,
} from './logger.types.js';

// Base
export type { IModuleConfig, IModuleLoggerConfig } from './base.types.js';

// Nest Decorators
export type {
  TCallProcedure,
  TCallSql,
  TDeleteAllSerializers,
  TDeleteSerializer,
  TGetDataSource,
  TMakeNotify,
  TSetSerializerHandler,
  TUnlistenNotify,
} from './nest-decorator.types.js';

// TypeORM Extend
export type {
  IBuildBaseQueryContext,
  IRepositoryContext,
  TEntityTargets,
  TEntityTargetFactory,
  TExtendPrimaryGeneratedColumnOptions,
  TPrimaryGeneratedColumnOverrideDescriptor,
  TRepositoryPropertyMap,
  TRepositoryPropertyPathsMap,
} from './typeorm-extend.types.js';
