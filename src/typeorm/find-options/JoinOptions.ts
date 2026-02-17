/**
 * Used to specify what entity relations should be loaded.
 *
 * Example:
 *  const options: JoinOptions = {
 *     alias: "photo",
 *     leftJoin: {
 *         author: "photo.author",
 *         categories: "categories",
 *         user: "categories.user",
 *         profile: "user.profile"
 *     },
 *     innerJoin: {
 *         author: "photo.author",
 *         categories: "categories",
 *         user: "categories.user",
 *         profile: "user.profile"
 *     },
 *     leftJoinAndSelect: {
 *         author: "photo.author",
 *         categories: "categories",
 *         user: "categories.user",
 *         profile: "user.profile"
 *     },
 *     innerJoinAndSelect: {
 *         author: "photo.author",
 *         categories: "categories",
 *         user: "categories.user",
 *         profile: "user.profile"
 *     }
 * };
 *
 * @deprecated
 */
export interface JoinOptions {
  /**
   * Alias of the main entity.
   */
  alias: string;

  /**
   * Object where each key represents the LEFT JOIN alias,
   * and the corresponding value represents the relation path.
   *
   * The columns of the joined table are included in the selection.
   */
  leftJoinAndSelect?: Record<string, string>;

  /**
   * Object where each key represents the INNER JOIN alias,
   * and the corresponding value represents the relation path.
   *
   * The columns of the joined table are included in the selection.
   */
  innerJoinAndSelect?: Record<string, string>;

  /**
   * Object where each key represents the LEFT JOIN alias,
   * and the corresponding value represents the relation path.
   *
   * This method does not select the columns of the joined table.
   */
  leftJoin?: Record<string, string>;

  /**
   * Object where each key represents the INNER JOIN alias,
   * and the corresponding value represents the relation path.
   *
   * This method does not select the columns of the joined table.
   */
  innerJoin?: Record<string, string>;
}
