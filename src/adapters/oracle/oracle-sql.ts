class OracleSqlCommandApi {
  /** Oracle 12.1+ package procedure metadata with package RECORD fields. */
  public readonly ['SQL_GET_PACKAGE_INFO'] = `
    WITH procedure_arguments AS (
      SELECT
        p.PROCEDURE_NAME AS "procedure_name",
        COALESCE(a.ARGUMENT_NAME, '__TPK_NO_ARGUMENT__') AS "argument_name",
        COALESCE(a.POSITION, 0) AS "order",
        COALESCE(a.DATA_TYPE, 'VOID') AS "argument_type",
        COALESCE(a.IN_OUT, 'IN') AS "mode",
        a.DATA_LENGTH AS "size",
        p.OWNER AS "owner",
        p.SUBPROGRAM_ID AS "subprogram_id",
        p.OVERLOAD AS "overload",
        COALESCE(a.DATA_LEVEL, 0) AS "data_level",
        a.SEQUENCE AS "sequence",
        a.TYPE_OWNER AS "type_owner",
        a.TYPE_NAME AS "type_name",
        a.TYPE_SUBNAME AS "type_subname",
        plsql_type.TYPECODE AS "plsql_typecode"
      FROM ALL_PROCEDURES p
      LEFT JOIN ALL_ARGUMENTS a
        ON a.OWNER = p.OWNER
        AND a.PACKAGE_NAME = p.OBJECT_NAME
        AND a.OBJECT_NAME = p.PROCEDURE_NAME
        AND a.SUBPROGRAM_ID = p.SUBPROGRAM_ID
        AND a.POSITION > 0
        AND a.DATA_LEVEL = 0
      LEFT JOIN ALL_PLSQL_TYPES plsql_type
        ON plsql_type.OWNER = a.TYPE_OWNER
        AND plsql_type.PACKAGE_NAME = a.TYPE_NAME
        AND plsql_type.TYPE_NAME = a.TYPE_SUBNAME
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
    )
    SELECT
      argument_rows."procedure_name",
      argument_rows."argument_name",
      argument_rows."order",
      argument_rows."argument_type",
      argument_rows."mode",
      argument_rows."size",
      argument_rows."owner",
      argument_rows."subprogram_id",
      argument_rows."overload",
      argument_rows."data_level",
      argument_rows."sequence",
      argument_rows."type_owner",
      argument_rows."type_name",
      argument_rows."type_subname",
      argument_rows."plsql_typecode"
    FROM procedure_arguments argument_rows
    UNION ALL
    SELECT
      argument_rows."procedure_name",
      type_attr.ATTR_NAME AS "argument_name",
      argument_rows."order",
      type_attr.ATTR_TYPE_NAME AS "argument_type",
      argument_rows."mode",
      type_attr.LENGTH AS "size",
      argument_rows."owner",
      argument_rows."subprogram_id",
      argument_rows."overload",
      1 AS "data_level",
      type_attr.ATTR_NO AS "sequence",
      type_attr.ATTR_TYPE_OWNER AS "type_owner",
      type_attr.ATTR_TYPE_PACKAGE AS "type_name",
      CASE
        WHEN type_attr.ATTR_TYPE_OWNER IS NOT NULL
          OR type_attr.ATTR_TYPE_PACKAGE IS NOT NULL
        THEN type_attr.ATTR_TYPE_NAME
      END AS "type_subname",
      nested_type.TYPECODE AS "plsql_typecode"
    FROM procedure_arguments argument_rows
    JOIN ALL_PLSQL_TYPE_ATTRS type_attr
      ON type_attr.OWNER = argument_rows."type_owner"
      AND type_attr.PACKAGE_NAME = argument_rows."type_name"
      AND type_attr.TYPE_NAME = argument_rows."type_subname"
    LEFT JOIN ALL_PLSQL_TYPES nested_type
      ON nested_type.OWNER = type_attr.ATTR_TYPE_OWNER
      AND nested_type.PACKAGE_NAME = type_attr.ATTR_TYPE_PACKAGE
      AND nested_type.TYPE_NAME = type_attr.ATTR_TYPE_NAME
    WHERE argument_rows."data_level" = 0
      AND argument_rows."type_subname" IS NOT NULL
      AND argument_rows."plsql_typecode" = 'RECORD'
    ORDER BY
      "procedure_name",
      "subprogram_id",
      "order",
      "data_level",
      "sequence" NULLS FIRST
  `;
  public readonly ['SQL_GET_NOTIFY_UPDATE_PACKAGE'] =
    "SELECT NAME FROM SOLUTION_ROOT.DB_OBJECT_LOG t WHERE ACTION='REPLACE' AND (:REPLACER_PACKAGES) AND TYPE='PACKAGE'";
}

const oracleSqlCommand = new OracleSqlCommandApi();

export { oracleSqlCommand as OracleSqlCommand };
