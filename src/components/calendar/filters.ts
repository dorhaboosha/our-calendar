// Which events the calendar shows: by owner (each user, or shared) and by category.
// Kept in the URL next to the view and date (?hideOwners=maayan&hideCategories=work),
// so a refresh or a shared link keeps them. The lists name what is HIDDEN, so the
// default, showing everything, needs nothing in the URL.

export type CalendarFilters = {
  /** Owner keys (user keys, or "shared") whose events are hidden. */
  hiddenOwners: string[];
  /** Category keys whose events are hidden. */
  hiddenCategories: string[];
};

export const SHOW_ALL: CalendarFilters = { hiddenOwners: [], hiddenCategories: [] };

const OWNERS_PARAM = "hideOwners";
const CATEGORIES_PARAM = "hideCategories";

export function isVisible(
  event: { owner: string; category: string },
  filters: CalendarFilters,
): boolean {
  return (
    !filters.hiddenOwners.includes(event.owner) &&
    !filters.hiddenCategories.includes(event.category)
  );
}

export function isFiltered(filters: CalendarFilters): boolean {
  return filters.hiddenOwners.length > 0 || filters.hiddenCategories.length > 0;
}

/** Hides a shown key or shows a hidden one, keeping the list in the given order. */
export function toggle(hidden: string[], key: string, order: readonly string[]): string[] {
  const next = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
  return order.filter((k) => next.includes(k));
}

/** The filters in the URL. Unknown keys are ignored, so an old link never breaks. */
export function readFilters(
  search: string,
  owners: readonly string[],
  categories: readonly string[],
): CalendarFilters {
  const params = new URLSearchParams(search);
  const list = (name: string, known: readonly string[]) => {
    const keys = (params.get(name) ?? "").split(",");
    return known.filter((key) => keys.includes(key));
  };
  return {
    hiddenOwners: list(OWNERS_PARAM, owners),
    hiddenCategories: list(CATEGORIES_PARAM, categories),
  };
}

/** The URL query with these filters; other parameters in `search` are kept. */
export function writeFilters(search: string, filters: CalendarFilters): string {
  const params = new URLSearchParams(search);
  const set = (name: string, keys: string[]) => {
    if (keys.length > 0) params.set(name, keys.join(","));
    else params.delete(name);
  };
  set(OWNERS_PARAM, filters.hiddenOwners);
  set(CATEGORIES_PARAM, filters.hiddenCategories);
  return `?${params}`;
}
