import { SqlIdentifier } from '../../utils/sql-identifier.js';

export abstract class PostgreSqlCommand {
  public static SQL_GET_PACKAGE_INFO = `
    SELECT
      args.ordinal_position AS "order",
      args.parameter_name AS "argument_name",
      args.parameter_mode AS "mode",
      args.udt_name AS "argument_type",
      proc.routine_name AS "procedure_name"
    FROM information_schema.routines proc
    LEFT JOIN information_schema.parameters args
      ON proc.specific_catalog = args.specific_catalog
      AND proc.specific_schema = args.specific_schema
      AND proc.specific_name = args.specific_name
    WHERE proc.specific_schema = :PACKAGE_NAME
  `;

  public static SQL_GET_NOTIFY_UPDATE_PACKAGE = `LISTEN ${SqlIdentifier.quotePostgresIdentifier(
    'db_object_event'
  )}`;

  public static generateNotifyUpdatePackage(listenEventName: string): string {
    return `LISTEN ${SqlIdentifier.quotePostgresIdentifier(listenEventName)}`;
  }
}
