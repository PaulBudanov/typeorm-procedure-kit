/**
 * Position object.
 * https://datatracker.ietf.org/doc/html/rfc7946#section-3.1.1
 */
export type Position = Array<number>;

/**
 * Point geometry object.
 * https://datatracker.ietf.org/doc/html/rfc7946#section-3.1.2
 */
export interface Point {
  type: 'Point';
  coordinates: Position;
}

/**
 * LineString geometry object.
 * https://datatracker.ietf.org/doc/html/rfc7946#section-3.1.4
 */
export interface LineString {
  type: 'LineString';
  coordinates: Array<Position>;
}

/**
 * Polygon geometry object.
 * https://datatracker.ietf.org/doc/html/rfc7946#section-3.1.6
 */
export interface Polygon {
  type: 'Polygon';
  coordinates: Array<Array<Position>>;
}

/**
 * MultiPoint geometry object.
 *  https://datatracker.ietf.org/doc/html/rfc7946#section-3.1.3
 */
export interface MultiPoint {
  type: 'MultiPoint';
  coordinates: Array<Position>;
}

/**
 * MultiLineString geometry object.
 * https://datatracker.ietf.org/doc/html/rfc7946#section-3.1.5
 */
export interface MultiLineString {
  type: 'MultiLineString';
  coordinates: Array<Array<Position>>;
}

/**
 * MultiPolygon geometry object.
 * https://datatracker.ietf.org/doc/html/rfc7946#section-3.1.7
 */
export interface MultiPolygon {
  type: 'MultiPolygon';
  coordinates: Array<Array<Array<Position>>>;
}

/**
 * Geometry Collection
 * https://datatracker.ietf.org/doc/html/rfc7946#section-3.1.8
 */
export interface GeometryCollection {
  type: 'GeometryCollection';
  geometries: Array<
    Point | LineString | Polygon | MultiPoint | MultiLineString | MultiPolygon
  >;
}

/**
 * Union of Geometry objects.
 */
export type Geometry =
  | Point
  | LineString
  | Polygon
  | MultiPoint
  | MultiLineString
  | MultiPolygon
  | GeometryCollection;
export type Geography = Geometry;

/**
 * A feature object which contains a geometry and associated properties.
 * https://datatracker.ietf.org/doc/html/rfc7946#section-3.2
 */
export interface Feature {
  type: 'Feature';
  geometry: Geometry;
  id?: string | number;
  bbox?: Array<number>;
  properties: Record<string, unknown> | null;
}

/**
 * A collection of feature objects.
 *  https://datatracker.ietf.org/doc/html/rfc7946#section-3.3
 */
export interface FeatureCollection {
  type: 'FeatureCollection';
  bbox?: Array<number>;
  features: Array<Feature>;
}

/**
 * Union of GeoJSON objects.
 */
export type GeoJSON = Geometry | Feature | FeatureCollection;
