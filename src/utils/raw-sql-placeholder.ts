/**
 * Shape of a raw SQL placeholder name that is bound, and that the SQL log
 * context lists: an unquoted identifier, in any letter case. Other names
 * `replaceNamedParameters` reports, such as the digit-first `:2` of a
 * PostgreSQL array slice `tags[1:2]` or a dotted `:new.id`, stay in the SQL
 * text untouched.
 */
export const RAW_SQL_PLACEHOLDER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
