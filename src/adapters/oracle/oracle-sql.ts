export abstract class OracleSqlCommand {
  public static SQL_GET_PACKAGE_INFO = `
    SELECT
      p.PROCEDURE_NAME AS "procedure_name",
      COALESCE(a.ARGUMENT_NAME, '__TPK_NO_ARGUMENT__') AS "argument_name",
      COALESCE(a.POSITION, 0) AS "order",
      COALESCE(a.DATA_TYPE, 'VOID') AS "argument_type",
      COALESCE(a.IN_OUT, 'IN') AS "mode",
      a.DATA_LENGTH AS "size",
      p.OWNER AS "owner",
      p.SUBPROGRAM_ID AS "subprogram_id",
      p.OVERLOAD AS "overload"
    FROM ALL_PROCEDURES p
    LEFT JOIN ALL_ARGUMENTS a
      ON a.OWNER = p.OWNER
      AND a.PACKAGE_NAME = p.OBJECT_NAME
      AND a.OBJECT_NAME = p.PROCEDURE_NAME
      AND a.SUBPROGRAM_ID = p.SUBPROGRAM_ID
      AND a.POSITION > 0
    WHERE p.OBJECT_NAME = :PACKAGE_NAME
      AND p.OWNER = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')
      AND p.PROCEDURE_NAME IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM ALL_ARGUMENTS return_arg
        WHERE return_arg.OWNER = p.OWNER
          AND return_arg.PACKAGE_NAME = p.OBJECT_NAME
          AND return_arg.OBJECT_NAME = p.PROCEDURE_NAME
          AND return_arg.SUBPROGRAM_ID = p.SUBPROGRAM_ID
          AND return_arg.POSITION = 0
      )
    ORDER BY p.PROCEDURE_NAME, p.SUBPROGRAM_ID, a.SEQUENCE NULLS FIRST
  `;
  public static SQL_GET_NOTIFY_UPDATE_PACKAGE =
    "SELECT NAME FROM SOLUTION_ROOT.DB_OBJECT_LOG t WHERE ACTION='REPLACE' AND (:REPLACER_PACKAGES) AND TYPE='PACKAGE'";
}
