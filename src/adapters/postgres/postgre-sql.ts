export abstract class PostgreSqlCommand {
  public static SQL_GET_PACKAGE_INFO = `SELECT args.ordinal_position as order, args.parameter_name as "argument_name",  args.parameter_mode as mode,  args.udt_name as "argument_type",   
     proc.routine_name  as "procedure_name"   from information_schema.routines proc     left join information_schema.parameters args      
     on proc.specific_name = args.specific_name   where args.specific_schema =`;

  public static SQL_GET_NOTIFY_UPDATE_PACKAGE = 'LISTEN db_object_event';

  public static generateNotifyUpdatePackage(listenEventName: string): string {
    return `LISTEN ${listenEventName.trim()}`;
  }
}
