"use client";

import { Button, HStack, Stack, Text } from "@chakra-ui/react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { textColorFor } from "@/modules/users/colors";
import { type CalendarFilters, SHOW_ALL, isFiltered, toggle } from "./filters";

export type FilterOption = { key: string; label: string };

type Props = {
  owners: FilterOption[];
  /** Each owner's event color: the owner chips double as the color legend. */
  ownerColors: Record<string, string>;
  categories: FilterOption[];
  filters: CalendarFilters;
  onChange: (filters: CalendarFilters) => void;
};

/**
 * Toggle chips that show or hide events by owner and by category. A shown chip is
 * filled; a hidden one is outlined and struck through, so the state never depends on
 * color alone (and aria-pressed tells screen readers).
 *
 * On phones the category row is folded behind a button, to leave room for the
 * calendar; the owner row stays, since it is also the color legend.
 */
export function CalendarFilterChips({ owners, ownerColors, categories, filters, onChange }: Props) {
  const t = useTranslations("home.filters");
  const id = useId();
  const ownerKeys = owners.map((owner) => owner.key);
  const categoryKeys = categories.map((category) => category.key);
  // Phones only: whether the category row is unfolded. Larger screens always show it.
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const hiddenCategoryCount = filters.hiddenCategories.length;

  return (
    <Stack gap="2" mb="3">
      <HStack role="group" aria-labelledby={`${id}-owners`} gap="2" wrap="wrap">
        <Text id={`${id}-owners`} fontSize="sm" color="fg.muted" minW="16">
          {t("owners")}
        </Text>
        {owners.map((owner) => {
          const shown = !filters.hiddenOwners.includes(owner.key);
          const color = ownerColors[owner.key];
          return (
            <Chip
              key={owner.key}
              label={owner.label}
              shown={shown}
              color={color}
              onClick={() =>
                onChange({
                  ...filters,
                  hiddenOwners: toggle(filters.hiddenOwners, owner.key, ownerKeys),
                })
              }
            />
          );
        })}
        <Button
          size="xs"
          variant="outline"
          hideFrom="md"
          aria-expanded={categoriesOpen}
          aria-controls={`${id}-category-row`}
          onClick={() => setCategoriesOpen((open) => !open)}
        >
          {hiddenCategoryCount > 0
            ? t("categoriesToggleHidden", { count: hiddenCategoryCount })
            : t("categoriesToggle")}
        </Button>
        {/* In the always-visible row, so it is reachable with the categories folded. */}
        {isFiltered(filters) && (
          <Button
            size="xs"
            variant="plain"
            textDecoration="underline"
            onClick={() => onChange(SHOW_ALL)}
          >
            {t("showAll")}
          </Button>
        )}
      </HStack>
      <HStack
        id={`${id}-category-row`}
        role="group"
        aria-labelledby={`${id}-categories`}
        gap="2"
        wrap="wrap"
        display={{ base: categoriesOpen ? "flex" : "none", md: "flex" }}
      >
        <Text id={`${id}-categories`} fontSize="sm" color="fg.muted" minW="16">
          {t("categories")}
        </Text>
        {categories.map((category) => (
          <Chip
            key={category.key}
            label={category.label}
            shown={!filters.hiddenCategories.includes(category.key)}
            onClick={() =>
              onChange({
                ...filters,
                hiddenCategories: toggle(filters.hiddenCategories, category.key, categoryKeys),
              })
            }
          />
        ))}
      </HStack>
    </Stack>
  );
}

function Chip({
  label,
  shown,
  color,
  onClick,
}: {
  label: string;
  shown: boolean;
  /** Fill color while shown; categories have none and use a neutral fill. */
  color?: string;
  onClick: () => void;
}) {
  const filled = shown && color ? { bg: color, color: textColorFor(color) } : {};
  return (
    <Button
      size="xs"
      borderRadius="full"
      aria-pressed={shown}
      variant={shown ? (color ? "solid" : "subtle") : "outline"}
      textDecoration={shown ? undefined : "line-through"}
      color={shown ? undefined : "fg.muted"}
      {...filled}
      _hover={shown && color ? { bg: color, opacity: 0.85 } : undefined}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}
