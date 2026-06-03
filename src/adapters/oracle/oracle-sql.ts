export abstract class OracleSqlCommand {
  public static SQL_GET_PACKAGE_INFO = `
    SELECT
      a.OBJECT_NAME AS "procedure_name",
      a.ARGUMENT_NAME AS "argument_name",
      a.POSITION AS "order",
      a.DATA_TYPE AS "argument_type",
      a.IN_OUT AS "mode"
    FROM ALL_ARGUMENTS a
    WHERE a.PACKAGE_NAME = :PACKAGE_NAME
  `;
  public static SQL_GET_NOTIFY_UPDATE_PACKAGE =
    "SELECT NAME FROM SOLUTION_ROOT.DB_OBJECT_LOG t WHERE ACTION='REPLACE' AND (:REPLACER_PACKAGES) AND TYPE='PACKAGE'";
}
