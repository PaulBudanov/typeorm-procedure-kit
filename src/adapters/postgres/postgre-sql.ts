import { SqlIdentifier } from '../../utils/sql-identifier.js';

class PostgreSqlCommandApi {
  public readonly ['SQL_GET_PACKAGE_INFO'] = `
    WITH procedure_arguments AS (
      SELECT
        proc.oid AS procedure_oid,
        argument.ordinality::integer AS ordinal_position,
        proc.proargnames[argument.ordinality::integer] AS parameter_name,
        CASE COALESCE(proc.proargmodes[argument.ordinality::integer], 'i')
          WHEN 'i' THEN 'IN'
          WHEN 'o' THEN 'OUT'
          WHEN 'b' THEN 'INOUT'
          WHEN 'v' THEN 'IN'
          WHEN 't' THEN 'OUT'
        END AS parameter_mode,
        argument.type_oid
      FROM pg_catalog.pg_proc proc
      CROSS JOIN LATERAL unnest(
        COALESCE(
          proc.proallargtypes,
          proc.proargtypes::oid[]
        )
      ) WITH ORDINALITY AS argument(type_oid, ordinality)
      WHERE proc.prokind = 'p'
    )
    SELECT
      COALESCE(args.ordinal_position, 0) AS "order",
      COALESCE(args.parameter_name, '__tpk_no_argument__') AS "argument_name",
      COALESCE(args.parameter_mode, 'IN') AS "mode",
      COALESCE(pg_catalog.format_type(args.type_oid, NULL), 'void') AS "argument_type",
      NULL::integer AS "size",
      proc.proname AS "procedure_name",
      proc.proname || '_' || proc.oid AS "specific_name",
      CASE
        WHEN composite_type.oid IS NULL THEN NULL
        ELSE 'postgres-composite'
      END AS "structured_kind",
      composite_namespace.nspname AS "structured_schema",
      composite_type.typname AS "structured_type_name",
      composite_type.oid::text AS "structured_type_oid",
      structured_fields.fields AS "structured_fields"
    FROM pg_catalog.pg_proc proc
    JOIN pg_catalog.pg_namespace procedure_namespace
      ON procedure_namespace.oid = proc.pronamespace
    LEFT JOIN procedure_arguments args
      ON args.procedure_oid = proc.oid
    LEFT JOIN pg_catalog.pg_type argument_type
      ON argument_type.oid = args.type_oid
    LEFT JOIN pg_catalog.pg_type element_type
      ON element_type.oid = argument_type.typelem
    LEFT JOIN pg_catalog.pg_type composite_type
      ON composite_type.oid = CASE
        WHEN argument_type.typtype = 'c' THEN argument_type.oid
        WHEN argument_type.typcategory = 'A' AND element_type.typtype = 'c'
          THEN element_type.oid
        ELSE NULL
      END
    LEFT JOIN pg_catalog.pg_namespace composite_namespace
      ON composite_namespace.oid = composite_type.typnamespace
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_strip_nulls(
          jsonb_build_object(
            'name', field.attname,
            'argumentType', pg_catalog.format_type(field.atttypid, field.atttypmod),
            'order', field.attnum,
            'typeOid', field.atttypid::text,
            'schema', nested_namespace.nspname,
            'typeName', nested_composite_type.typname
          )
        )
        ORDER BY field.attnum
      ) AS fields
      FROM pg_catalog.pg_attribute field
      JOIN pg_catalog.pg_type field_type
        ON field_type.oid = field.atttypid
      LEFT JOIN pg_catalog.pg_type field_element_type
        ON field_element_type.oid = field_type.typelem
      LEFT JOIN pg_catalog.pg_type nested_composite_type
        ON nested_composite_type.oid = CASE
          WHEN field_type.typtype = 'c' THEN field_type.oid
          WHEN field_type.typcategory = 'A' AND field_element_type.typtype = 'c'
            THEN field_element_type.oid
          ELSE NULL
        END
      LEFT JOIN pg_catalog.pg_namespace nested_namespace
        ON nested_namespace.oid = nested_composite_type.typnamespace
      WHERE field.attrelid = composite_type.typrelid
        AND field.attnum > 0
        AND NOT field.attisdropped
    ) structured_fields ON composite_type.oid IS NOT NULL
    WHERE procedure_namespace.nspname = :PACKAGE_NAME
      AND proc.prokind = 'p'
    ORDER BY proc.proname, proc.oid, args.ordinal_position NULLS FIRST
  `;

  public readonly ['SQL_GET_NOTIFY_UPDATE_PACKAGE'] = `LISTEN ${SqlIdentifier.quotePostgresIdentifier(
    'db_object_event'
  )}`;

  public generateNotifyUpdatePackage(listenEventName: string): string {
    return `LISTEN ${SqlIdentifier.quotePostgresIdentifier(listenEventName)}`;
  }
}

const postgreSqlCommand = new PostgreSqlCommandApi();

export { postgreSqlCommand as PostgreSqlCommand };
