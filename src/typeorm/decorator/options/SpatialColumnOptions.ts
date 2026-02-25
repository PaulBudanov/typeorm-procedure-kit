/**
 * Geometry type for spatial columns.
 */
export interface Geometry {
  type:
    | 'Point'
    | 'LineString'
    | 'Polygon'
    | 'MultiPoint'
    | 'MultiLineString'
    | 'MultiPolygon'
    | 'GeometryCollection';
  coordinates: unknown;
}

/**
 * Options for spatial columns.
 */
export interface SpatialColumnOptions {
  /**
   * Column type's feature type.
   * Geometry, Point, Polygon, etc.
   */
  spatialFeatureType?: Geometry['type'];

  /**
   * Column type's SRID.
   * Spatial Reference ID or EPSG code.
   */
  srid?: number;
}
