/**
 * Entity ID type supporting Oracle and PostgreSQL only.
 * MongoDB ObjectId is not supported in this library.
 */
export type EntityId = string | number | Date;
