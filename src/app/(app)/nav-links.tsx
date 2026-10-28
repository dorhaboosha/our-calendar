"use client";

import { HStack, Link } from "@chakra-ui/react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";

type Props = {
  label: string;
  links: { href: string; label: string }[];
};

export function NavLinks({ label, links }: Props) {
  const pathname = usePathname();

  return (
    <HStack as="nav" aria-label={label} gap="4">
      {links.map((link) => {
        const current = pathname === link.href;
        return (
          <Link
            key={link.href}
            asChild
            fontWeight={current ? "semibold" : "normal"}
            textDecoration={current ? "underline" : "none"}
            textUnderlineOffset="4px"
          >
            <NextLink href={link.href} aria-current={current ? "page" : undefined}>
              {link.label}
            </NextLink>
          </Link>
        );
      })}
    </HStack>
  );
}
