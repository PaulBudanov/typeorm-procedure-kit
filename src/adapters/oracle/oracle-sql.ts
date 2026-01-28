export abstract class OracleSqlCommand {
  public static SQL_GET_PACKAGE_INFO =
    'SELECT a.OBJECT_NAME as "procedure_name", a.ARGUMENT_NAME as "argument_name" , a.POSITION as "order", a.DATA_TYPE as "argument_type", a.PACKAGE_NAME as "package_name", a.IN_OUT as "mode" FROM ALL_ARGUMENTS a WHERE a.PACKAGE_NAME IN ';
  public static SQL_GET_NOTIFY_UPDATE_PACKAGE =
    "SELECT NAME FROM SOLUTION_ROOT.DB_OBJECT_LOG t WHERE ACTION='REPLACE' AND (:REPLACER_PACKAGES) AND TYPE='PACKAGE'";
}
