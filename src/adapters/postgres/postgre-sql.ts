import { SqlIdentifier } from '../../utils/sql-identifier.js';

export abstract class PostgreSqlCommand {
  public static SQL_GET_PACKAGE_INFO = `
    SELECT
      COALESCE(args.ordinal_position, 0) AS "order",
      COALESCE(args.parameter_name, '__tpk_no_argument__') AS "argument_name",
      COALESCE(args.parameter_mode, 'IN') AS "mode",
      COALESCE(args.udt_name, 'void') AS "argument_type",
      args.character_maximum_length AS "size",
      proc.routine_name AS "procedure_name",
      proc.specific_name AS "specific_name"
    FROM information_schema.routines proc
    LEFT JOIN information_schema.parameters args
      ON proc.specific_catalog = args.specific_catalog
      AND proc.specific_schema = args.specific_schema
      AND proc.specific_name = args.specific_name
    WHERE proc.specific_schema = :PACKAGE_NAME
      AND proc.routine_type = 'PROCEDURE'
    ORDER BY proc.routine_name, proc.specific_name, args.ordinal_position NULLS FIRST
  `;

  public static SQL_GET_NOTIFY_UPDATE_PACKAGE = `LISTEN ${SqlIdentifier.quotePostgresIdentifier(
    'db_object_event'
  )}`;

  public static generateNotifyUpdatePackage(listenEventName: string): string {
    return `LISTEN ${SqlIdentifier.quotePostgresIdentifier(listenEventName)}`;
  }
}
